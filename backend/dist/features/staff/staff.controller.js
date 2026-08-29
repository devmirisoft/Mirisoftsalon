import {} from "express";
import { StaffModel } from "./staff.model.js";
import { BranchModel } from "../branches/branch.model.js";
import { SalonModel } from "../salons/salon.model.js";
const getSalonInitials = (salonName) => {
    const words = salonName
        .trim()
        .split(/\s+/)
        .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
        .filter(Boolean);
    if (words.length === 0) {
        return "SL";
    }
    if (words.length === 1) {
        return words[0].slice(0, 2).toUpperCase();
    }
    return words.map((word) => word[0]).join("").toUpperCase();
};
const getIsoWeekday = (date) => {
    const utcDay = date.getUTCDay();
    return utcDay === 0 ? 7 : utcDay;
};
const generateStaffCode = (salonName, joiningDate, phone) => {
    const phoneDigits = phone.replace(/\D/g, "");
    const month = String(joiningDate.getUTCMonth() + 1).padStart(2, "0");
    const weekday = getIsoWeekday(joiningDate);
    const phoneSuffix = phoneDigits.slice(-3);
    return `${getSalonInitials(salonName)}-${month}-${weekday}-${phoneSuffix}`;
};
const getStaffIdParam = (req) => {
    const { id } = req.params;
    return typeof id === "string" ? id : null;
};
export const createStaff = async (req, res) => {
    try {
        const { name, email, phone, jobRole, workingFrom, workingTo, weekOff, joiningDate, salonId, branchId, reportingManagerId, } = req.body;
        if (!name ||
            !email ||
            !phone ||
            !jobRole ||
            !workingFrom ||
            !workingTo ||
            !weekOff) {
            return res.status(400).json({
                success: false,
                message: "Name, email, phone and work details are required",
            });
        }
        const phoneDigits = String(phone).replace(/\D/g, "");
        if (phoneDigits.length < 3) {
            return res.status(400).json({
                success: false,
                message: "Phone number must contain at least 3 digits",
            });
        }
        let finalSalonId;
        if (req.user?.role === "SUPER_ADMIN") {
            if (!salonId) {
                return res.status(400).json({
                    success: false,
                    message: "salonId is required for SUPER_ADMIN",
                });
            }
            finalSalonId = salonId;
        }
        else {
            finalSalonId = req.user?.salonId;
        }
        if (!finalSalonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is missing",
            });
        }
        const salon = await SalonModel.findById(finalSalonId);
        if (!salon) {
            return res.status(400).json({
                success: false,
                message: "Salon not found",
            });
        }
        const finalJoiningDate = joiningDate ? new Date(joiningDate) : new Date();
        if (Number.isNaN(finalJoiningDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid joiningDate",
            });
        }
        const staffCode = generateStaffCode(salon.name, finalJoiningDate, String(phone));
        const existingStaffCode = await StaffModel.findByStaffCode(staffCode, finalSalonId);
        if (existingStaffCode) {
            return res.status(409).json({
                success: false,
                message: "Staff code already exists",
            });
        }
        if (branchId) {
            const branch = await BranchModel.findByIdandSalon(branchId, finalSalonId);
            if (!branch) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid branch for this salon",
                });
            }
        }
        const staff = await StaffModel.create({
            staffCode,
            name,
            email,
            phone: String(phone),
            jobRole,
            workingFrom,
            workingTo,
            weekOff,
            joiningDate: finalJoiningDate,
            salonId: finalSalonId,
            branchId,
            reportingManagerId,
        });
        return res.status(201).json({
            success: true,
            message: "Staff created successfully",
            data: staff,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const updateStaffStatus = async (req, res) => {
    try {
        const id = getStaffIdParam(req);
        const { status } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Staff ID is required",
            });
        }
        if (typeof status !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "Status must be true or false",
            });
        }
        let existingStaff;
        if (req.user?.role === "SUPER_ADMIN") {
            existingStaff = await StaffModel.findById(id);
        }
        else {
            if (!req.user?.salonId) {
                return res.status(400).json({
                    success: false,
                    message: "Salon ID is missing",
                });
            }
            existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
        }
        if (!existingStaff) {
            return res.status(404).json({
                success: false,
                message: "Staff not found",
            });
        }
        const updatedStaff = await StaffModel.updateStatus(id, status);
        return res.status(200).json({
            success: true,
            message: "Staff status updated successfully",
            data: updatedStaff,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const deleteStaff = async (req, res) => {
    try {
        const id = getStaffIdParam(req);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Staff ID is required",
            });
        }
        let existingStaff;
        if (req.user?.role === "SUPER_ADMIN") {
            existingStaff = await StaffModel.findById(id);
        }
        else {
            if (!req.user?.salonId) {
                return res.status(400).json({
                    success: false,
                    message: "Salon ID is missing",
                });
            }
            existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
        }
        if (!existingStaff) {
            return res.status(404).json({
                success: false,
                message: "Staff not found",
            });
        }
        await StaffModel.delete(id);
        return res.status(200).json({
            success: true,
            message: "Staff deleted successfully",
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const updateStaff = async (req, res) => {
    try {
        const id = getStaffIdParam(req);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Staff ID is required",
            });
        }
        let existingStaff;
        if (req.user?.role === "SUPER_ADMIN") {
            existingStaff = await StaffModel.findById(id);
        }
        else {
            if (!req.user?.salonId) {
                return res.status(400).json({
                    success: false,
                    message: "Salon ID is missing",
                });
            }
            existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
        }
        if (!existingStaff) {
            return res.status(404).json({
                success: false,
                message: "Staff not found",
            });
        }
        const updatedStaff = await StaffModel.update(id, {
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            jobRole: req.body.jobRole,
            workingFrom: req.body.workingFrom,
            workingTo: req.body.workingTo,
            weekOff: req.body.weekOff,
            branchId: req.body.branchId,
            reportingManagerId: req.body.reportingManagerId,
        });
        return res.status(200).json({
            success: true,
            message: "Staff updated successfully",
            data: updatedStaff,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const getStaffById = async (req, res) => {
    try {
        const id = getStaffIdParam(req);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Staff ID is required",
            });
        }
        let staff;
        if (req.user?.role === "SUPER_ADMIN") {
            staff = await StaffModel.findById(id);
        }
        else {
            if (!req.user?.salonId) {
                return res.status(400).json({
                    success: false,
                    message: "Salon ID is missing",
                });
            }
            staff = await StaffModel.findByIdAndSalon(id, req.user.salonId, req.user.role === "RECEPTIONIST" ? req.user.branchId : undefined);
        }
        if (!staff) {
            return res.status(404).json({
                success: false,
                message: "Staff not found",
            });
        }
        return res.status(200).json({
            success: true,
            message: "Staff fetched successfully",
            data: staff,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const getStaff = async (req, res) => {
    try {
        if (req.user?.role === "SUPER_ADMIN") {
            const staff = await StaffModel.findAll();
            return res.status(200).json({
                success: true,
                message: "Staff fetched successfully",
                data: staff,
            });
        }
        if (!req.user?.salonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is missing",
            });
        }
        const staff = await StaffModel.findBySalon(req.user.salonId, req.user.role === "RECEPTIONIST" ? req.user.branchId : undefined);
        return res.status(200).json({
            success: true,
            message: "Staff fetched successfully",
            data: staff,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
