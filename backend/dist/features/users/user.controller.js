import {} from "express";
import { UserModel } from "./user.model.js";
import { hashPass } from "../../utils/password.js";
import { BranchModel } from "../branches/branch.model.js";
import { StaffModel } from "../staff/staff.model.js";
export const getUsers = async (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Users fetched successfully",
        currentUser: req.user,
    });
};
export const createSalonAdmin = async (req, res) => {
    try {
        const { name, email, phone_number, password, salonId } = req.body;
        if (!name || !email || !phone_number || !password || !salonId) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
            });
        }
        const existingUser = await UserModel.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "Email already exists",
            });
        }
        const existingPhone = await UserModel.findByPhoneNumber(phone_number);
        if (existingPhone) {
            return res.status(400).json({
                success: false,
                message: "Phone number already exists",
            });
        }
        const passwordHash = await hashPass(password);
        const admin = await UserModel.createSalonAdmin({
            name,
            email,
            phone_number,
            passwordHash,
            salonId,
        });
        return res.status(201).json({
            success: true,
            message: "Salon admin created successfully",
            data: admin,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const createReceptionist = async (req, res) => {
    try {
        const { name, email, phone_number, password, salonId, branchId } = req.body;
        if (!name || !email || !phone_number || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email, phone number and password are required",
            });
        }
        const finalSalonId = req.user?.role === "SUPER_ADMIN" ? salonId : req.user?.salonId;
        if (!finalSalonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is required",
            });
        }
        if (branchId) {
            const branch = await BranchModel.findByIdAndSalon(branchId, finalSalonId);
            if (!branch) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid branch for this salon",
                });
            }
        }
        if (await UserModel.findByEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Email already exists",
            });
        }
        if (await UserModel.findByPhoneNumber(phone_number)) {
            return res.status(400).json({
                success: false,
                message: "Phone number already exists",
            });
        }
        const receptionist = await UserModel.createReceptionist({
            name,
            email,
            phone_number,
            passwordHash: await hashPass(password),
            salonId: finalSalonId,
            ...(branchId ? { branchId } : {}),
        });
        return res.status(201).json({
            success: true,
            message: "Receptionist created successfully",
            data: receptionist,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const createStaffAccount = async (req, res) => {
    try {
        const { staffId, password } = req.body;
        if (!staffId || !password) {
            return res.status(400).json({
                success: false,
                message: "staffId and password are required",
            });
        }
        const staff = req.user?.role === "SUPER_ADMIN"
            ? await StaffModel.findById(staffId)
            : req.user?.salonId
                ? await StaffModel.findByIdAndSalon(staffId, req.user.salonId)
                : null;
        if (!staff) {
            return res.status(404).json({
                success: false,
                message: "Staff not found",
            });
        }
        if (staff.userId) {
            return res.status(409).json({
                success: false,
                message: "Staff login already exists",
            });
        }
        if (!staff.phone) {
            return res.status(400).json({
                success: false,
                message: "Staff phone number is required to create a login",
            });
        }
        if (await UserModel.findByEmail(staff.email)) {
            return res.status(400).json({
                success: false,
                message: "Email already exists",
            });
        }
        if (await UserModel.findByPhoneNumber(staff.phone)) {
            return res.status(400).json({
                success: false,
                message: "Phone number already exists",
            });
        }
        const user = await UserModel.createStaffAccount({
            staffId: staff.id,
            name: staff.name,
            email: staff.email,
            phone_number: staff.phone,
            passwordHash: await hashPass(password),
            salonId: staff.salonId,
            ...(staff.branchId ? { branchId: staff.branchId } : {}),
        });
        return res.status(201).json({
            success: true,
            message: "Staff login created successfully",
            data: user,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const updateUserStatus = async (req, res) => {
    try {
        const id = typeof req.params.id === "string" ? req.params.id : "";
        const status = req.body.status;
        const validStatuses = ["ACTIVE", "DISABLED", "SUSPENDED"];
        if (!id || !status || !validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Valid user status is required" });
        }
        const target = await UserModel.findById(id);
        if (!target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (req.user?.role !== "SUPER_ADMIN" &&
            (!req.user?.salonId || target.salonId !== req.user.salonId)) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const user = await UserModel.updateStatus(id, status);
        return res.status(200).json({ success: true, message: "User status updated", data: user });
    }
    catch {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
