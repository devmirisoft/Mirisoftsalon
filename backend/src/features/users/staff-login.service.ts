import { UserModel } from "./user.model.js";

// A staff login is provisioned two ways - with the password field on the staff
// create form, or later for an existing staff row - so both run these checks.
export const staffLoginError = async (
  staff: {
    email: string;
    phone: string | null;
    branchId: string | null;
    userId?: string | null;
  },
  password: unknown
): Promise<{ status: number; message: string } | null> => {
  if (typeof password !== "string" || password.length < 6) {
    return { status: 400, message: "Password must be at least 6 characters" };
  }

  if (staff.userId) {
    return { status: 409, message: "Staff login already exists" };
  }

  // The login inherits the staff member's branch, and STAFF is branch-locked,
  // so provisioning a login for an unassigned staff row would create a user
  // that no branch filter applies to.
  if (!staff.branchId) {
    return {
      status: 400,
      message: "Assign this staff member to a branch before creating their login",
    };
  }

  if (!staff.phone) {
    return {
      status: 400,
      message: "Staff phone number is required to create a login",
    };
  }

  if (await UserModel.findByEmail(staff.email)) {
    return { status: 400, message: "Email already exists" };
  }

  if (await UserModel.findByPhoneNumber(staff.phone)) {
    return { status: 400, message: "Phone number already exists" };
  }

  return null;
};
