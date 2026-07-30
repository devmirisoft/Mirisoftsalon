# AI Chat / AI Assistant Current State Report

Date: 2026-07-11

This report reflects the current in-progress code in the working tree, not a confirmed production deployment.

## 1. Executive Summary

The AI assistant feature is implemented as a lightweight internal salon data assistant with:

- a floating chat widget in the frontend
- one authenticated backend chat endpoint
- a rule-based intent router
- six read-only business data tools
- a provider abstraction with `dev` and Gemini modes

The feature is functionally well-scoped for first release, but it is not currently build-clean. The main blockers are ESM import issues, missing permission-scope helper exports, and a runtime/type import mismatch that causes the AI assistant test suite to fail before tests run.

## 2. Current User Experience

Frontend entry point:

- `frontend/src/components/FloatingAiAssistant.jsx`
- mounted globally in `frontend/src/layout/Index.jsx`

Current UX behavior:

- The assistant appears as a floating `AI` button on the main application layout.
- Clicking it opens a small chat panel titled `Salon AI`.
- Users can send free-text questions or click quick prompts.
- Quick prompts currently cover:
  - appointments today
  - today's revenue
  - low stock products
  - customers with outstanding balance
- The UI shows the assistant reply and any backend-reported `usedTools`.
- Chat history is local component state only.

Current UX limitations:

- No persistence across page refreshes or sessions.
- No conversation memory beyond the current open widget state.
- No streaming responses.
- No typing indicator beyond a simple static `Thinking...` state.
- No role-based hiding of the widget in the frontend; restricted users can open it but may receive blocked responses.
- Some text appears to have encoding issues in the component.

## 3. Backend Architecture

Primary backend files:

- `backend/src/features/ai-assistant/ai-assistant.routes.ts`
- `backend/src/features/ai-assistant/ai-assistant.controller.ts`
- `backend/src/features/ai-assistant/ai-assistant.service.ts`
- `backend/src/features/ai-assistant/ai-intent-router.ts`
- `backend/src/features/ai-assistant/ai-tool-registry.ts`
- `backend/src/features/ai-assistant/providers/ai.provider.ts`
- `backend/src/features/ai-assistant/providers/gemini.providers.ts`

Route contract:

- Endpoint: `POST /api/ai-assistant/chat`
- Authentication: required via `authenticate`
- Request body: `{ "message": string }`
- Response shape:
  - `success`
  - `data.answer`
  - `data.usedTools`

Request flow:

1. Frontend posts the user message to `/api/ai-assistant/chat`.
2. Controller reads `req.user` and builds assistant context:
   - `userId`
   - `role`
   - `salonId`
   - `branchId`
3. Service calls `detectToolName(message)`.
4. The result is one of:
   - `BLOCKED`
   - a single tool name
   - `null`
5. If a tool is selected:
   - registry resolves the tool
   - role permission is checked
   - tool runs a Prisma query
   - result is passed to the configured AI provider
6. The provider returns the final answer.

Important architectural characteristics:

- The assistant is currently single-turn and single-tool.
- Intent routing is keyword-based, not model-driven.
- The provider only rewrites/summarizes backend tool output; it is not meant to freely query data.
- The default provider is `dev`, which simply returns tool summaries without using an LLM.

## 4. Supported Assistant Capabilities

Registered tools in `backend/src/features/ai-assistant/ai-tool-registry.ts`:

1. `getTodayAppointments`
2. `getRevenueSummary`
3. `getLowStockProducts`
4. `getOutstandingCustomers`
5. `getPackageExpirySummary`
6. `getMembershipExpirySummary`

### 4.1 Tool: Today's appointments

File:

- `backend/src/features/ai-assistant/tools/getTodayAppointments.tool.ts`

Behavior:

- Uses the salon timezone from `salon.timezone`
- Falls back to `Asia/Kolkata`
- Builds today's range with `parseSalonDateRange`
- Counts appointments and groups by status

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`
- `RECEPTIONIST`

### 4.2 Tool: Today's revenue

File:

- `backend/src/features/ai-assistant/tools/getRevenueSummary.tool.ts`

Behavior:

- Uses salon timezone
- Aggregates `payment.amount` for payments collected today
- Returns INR-formatted summary and payment count

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`

### 4.3 Tool: Low stock products

File:

- `backend/src/features/ai-assistant/tools/getLowStockProducts.tool.ts`

Behavior:

- Reads active products with `lowStockAlert > 0`
- Filters products where `currentStock <= lowStockAlert`
- Returns at most 20 products

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`

### 4.4 Tool: Outstanding customers

File:

- `backend/src/features/ai-assistant/tools/getOutstandingCustomers.tool.ts`

Behavior:

- Finds customers with `outstandingAmount > 0`
- Returns top 20 by outstanding amount
- Aggregates total outstanding amount in INR

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`
- `RECEPTIONIST`

### 4.5 Tool: Package expiry summary

File:

- `backend/src/features/ai-assistant/tools/getPackageExpirySummary.tool.ts`

Behavior:

- Finds active customer packages expiring within 30 days
- Returns up to 20 packages sorted by nearest expiry

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`
- `RECEPTIONIST`

### 4.6 Tool: Membership expiry summary

File:

- `backend/src/features/ai-assistant/tools/getMembershipExpirySummary.tool.ts`

Behavior:

- Finds active customer memberships expiring within 30 days
- Returns up to 20 memberships sorted by nearest expiry

Allowed roles:

- `SUPER_ADMIN`
- `SALON_ADMIN`
- `BRANCH_MANAGER`
- `RECEPTIONIST`

## 5. Intent Routing and Safety Model

Intent router file:

- `backend/src/features/ai-assistant/ai-intent-router.ts`

Current routing model:

- Pure keyword matching
- One matched tool per request
- Static blocklist for clearly unsafe/write-like prompts

Examples of blocked phrases:

- `delete`
- `drop table`
- `cancel all`
- `update salary`
- `export all`
- `show password`
- `show token`

What this means in practice:

- The feature is intentionally narrow and safer than a fully open-ended agent.
- It is easy to reason about which backend query will run.
- Query understanding is limited and brittle; unsupported phrasing may fall through.

## 6. AI Provider Design

Provider selection file:

- `backend/src/features/ai-assistant/providers/ai.provider.ts`

### 6.1 Dev provider

Default behavior:

- `AI_PROVIDER` defaults to `dev`
- If tool results exist, it returns their summaries directly
- If no tool matches, it returns a canned fallback message

This is useful for:

- local development
- predictable testing
- operating without third-party model dependency

### 6.2 Gemini provider

File:

- `backend/src/features/ai-assistant/providers/gemini.providers.ts`

Dependencies and env vars:

- package: `@google/genai`
- `GEMINI_API_KEY` required
- `GEMINI_MODEL` optional, default `gemini-2.5-flash`

Prompting behavior:

- instructs the model to answer only from provided tool results
- forbids invented facts
- forbids exposing secrets
- forbids write actions
- asks for short business-friendly answers

Important note:

- The provider sends raw `toolResults.data` to Gemini as `safeToolData`, but the redaction utility is not currently applied in this path.

## 7. Data Access, Scope, and Permissions

Types file:

- `backend/src/features/ai-assistant/ai-tool.types.ts`

Context fields:

- `userId`
- `role`
- `salonId`
- `branchId`

Permission file:

- `backend/src/features/ai-assistant/ai-permission.service.ts`

Current implemented permission behavior:

- `canUseAiTool(role, tool)` checks role membership against each tool's `allowedRoles`

Intended scoping behavior:

- several tools import `aiExactBranchScope`
- low stock imports `aiSharedBranchScope`

Current issue:

- those scope helpers are referenced by tools but are not exported from `ai-permission.service.ts` in the current working tree
- this is a hard TypeScript build failure

Interpretation:

- role-based access is partly implemented
- tenant/branch query scoping appears intended in tool code
- the helper implementation is currently incomplete or accidentally removed

## 8. Testing and Verification Status

Test file:

- `backend/src/__tests__/ai-assistant.test.ts`

Current tests are designed to verify:

- tool registration
- intent routing
- recursive redaction
- authentication
- request validation
- salon/branch scoping behavior
- blocking of unsafe prompts
- role restrictions

### 8.1 Test run result

Command run:

```powershell
npm.cmd test -- --runTestsByPath src/__tests__/ai-assistant.test.ts
```

Result:

- test suite failed before executing tests

Failure:

- `The requested module './ai-tool.types' does not provide an export named 'AiRole'`

Root cause:

- `AiRole` is exported as a TypeScript type
- `ai-permission.service.ts` imports it as a runtime import instead of a type-only import

### 8.2 Build result

Command run:

```powershell
npm.cmd run build
```

Result:

- backend build failed

Observed failure categories:

- type-only import violations under `verbatimModuleSyntax`
- missing `.js` extensions on relative ESM imports
- unresolved local module imports
- missing `aiExactBranchScope` / `aiSharedBranchScope` exports

Conclusion:

- the feature is not currently in a releasable backend state
- the code clearly outlines the intended design, but implementation cleanup is still required

## 9. Gaps and Risks

### 9.1 Build/runtime blockers

- AI assistant backend does not compile successfully in current state.
- Tests do not run due to import/export mismatch before assertions execute.

### 9.2 Data safety gap

- `redactAiData()` exists and is tested, but it is not used in the actual provider call path.
- This means tool result payloads may be sent to Gemini without the intended recursive redaction layer.

### 9.3 Limited language understanding

- Intent detection is exact keyword matching.
- Only one tool can run per question.
- Questions like "compare today's revenue and appointments" are not handled as multi-tool requests.

### 9.4 No persistence or observability

- No saved conversations
- No feedback mechanism
- No usage analytics
- No assistant audit trail beyond normal API/server logging

### 9.5 Frontend polish issues

- Encoding artifacts in UI text
- Inline style implementation only
- No empty-state, retry, or richer error treatment

## 10. Recommended Next Steps

### Immediate stabilization

1. Fix all AI assistant ESM imports to match the backend's `.js` import convention and `verbatimModuleSyntax` rules.
2. Restore or implement `aiExactBranchScope` and `aiSharedBranchScope` in `ai-permission.service.ts`.
3. Convert runtime-only type imports to `import type`.
4. Re-run:
   - `npm.cmd run build`
   - `npm.cmd test -- --runTestsByPath src/__tests__/ai-assistant.test.ts`

### Security hardening

1. Apply `redactAiData()` before passing tool result payloads into Gemini.
2. Review each tool payload to ensure only needed fields are returned.
3. Consider backend-side response shaping per tool instead of sending raw selected records.

### Product improvements

1. Hide or disable the widget for roles with little or no supported access.
2. Add richer fallback handling for unsupported questions.
3. Add multi-tool orchestration for combined questions.
4. Add optional conversation persistence and audit logging.
5. Add frontend polish for encoding cleanup, loading states, and retry UX.

## 11. Overall Assessment

The AI assistant feature has a solid MVP direction:

- narrow scope
- read-only data access
- explicit role permissions
- tenant-aware intent in the tool design
- optional LLM summarization layer

At the same time, the current branch is still in integration phase. The design is stronger than the current build health. Once the import issues, permission-scope helpers, and redaction wiring are corrected, this can become a practical internal assistant for daily salon operations.
