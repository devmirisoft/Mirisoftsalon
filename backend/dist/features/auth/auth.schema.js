import { z } from "zod";
const normalizeRegisterInput = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    const input = value;
    return {
        ...input,
        adminName: input.adminName ?? input.name,
        phone: input.phone ?? input.phone_number,
    };
};
export const registerSchema = z.preprocess(normalizeRegisterInput, z.object({
    salonName: z
        .string({ error: "Salon Name is required. Example: Glow Salon." })
        .trim()
        .min(2, "Salon Name is too short. Example: Glow Salon."),
    branchName: z
        .string()
        .trim()
        .min(2, "Main Branch Name is too short. Example: Main Branch.")
        .optional(),
    adminName: z
        .string({ error: "Admin Name is required. Example: Jatin Sharma." })
        .trim()
        .min(3, "Admin Name is too short. Example: Jatin Sharma."),
    email: z
        .email({ error: "Email is invalid. Example: admin@glowsalon.com." })
        .transform((value) => value.trim().toLowerCase()),
    phone: z
        .string({ error: "Phone Number is required. Example: 9876543210." })
        .transform((value) => value.replace(/\D/g, ""))
        .pipe(z
        .string()
        .regex(/^\d{10}$/, "Phone Number is invalid. Use 10 digits. Example: 9876543210.")),
    password: z
        .string({ error: "Passcode is required. Example: StrongPass123." })
        .min(6, "Passcode is too short. Use at least 6 characters. Example: StrongPass123."),
    confirmPassword: z
        .string({ error: "Confirm Passcode is required. Re-enter the same passcode." })
        .min(6, "Confirm Passcode is too short. Use at least 6 characters. Example: StrongPass123."),
    address: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    pincode: z.string().trim().optional(),
    timezone: z.string().trim().optional(),
}).refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Confirm Passcode does not match. Example: type the same value as Passcode.",
}));
export const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(6),
});
