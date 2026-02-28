const { ComboGroup, VendorProfile, Combo } = require("../models");
const { paginate } = require("../utils/paginate");

const createComboGroup = async (req, res) => {
    try {
        const { name, description } = req.body;
        const vendorId = req.user.id;
        const vendor = await VendorProfile.findOne({ owner: vendorId });

        if (!vendor) {
            return res
                .status(404)
                .json({ success: false, message: "Vendor profile not found" });
        }

        if (!name) {
            return res
                .status(400)
                .json({ success: false, message: "Name is required" });
        }

        const comboGroup = await ComboGroup.create({
            name,
            description,
            vendor: vendor._id,
        });

        res.status(201).json({
            success: true,
            message: "Combo group created successfully",
            data: comboGroup,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateComboGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, description, status } = req.body;

        const comboGroup = await ComboGroup.findById(groupId).populate("vendor");

        if (!comboGroup) {
            return res
                .status(404)
                .json({ success: false, message: "Combo group not found" });
        }

        if (!comboGroup.vendor.owner.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to update this combo group",
            });
        }

        if (name) comboGroup.name = name;
        if (description) comboGroup.description = description;
        if (status) comboGroup.status = status;

        await comboGroup.save();

        res.status(200).json({
            success: true,
            message: "Combo group updated successfully",
            data: comboGroup,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteComboGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const comboGroup = await ComboGroup.findById(groupId).populate("vendor");

        if (!comboGroup) {
            return res
                .status(404)
                .json({ success: false, message: "Combo group not found" });
        }

        if (!comboGroup.vendor.owner.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to delete this combo group",
            });
        }

        // Check if any combos are using this group
        const combosUsingGroup = await Combo.countDocuments({ comboGroup: groupId });
        if (combosUsingGroup > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete group with associated combos",
            });
        }

        await comboGroup.deleteOne();

        res.status(200).json({
            success: true,
            message: "Combo group deleted successfully",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getVendorComboGroups = async (req, res) => {
    try {
        const { vendorId } = req.params;
        const filter = { vendor: vendorId };

        const result = await paginate(ComboGroup, req.query, null, filter);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyComboGroups = async (req, res) => {
    try {
        const vendor = await VendorProfile.findOne({ owner: req.user.id });
        if (!vendor) {
            return res
                .status(404)
                .json({ success: false, message: "Vendor profile not found" });
        }

        const filter = { vendor: vendor._id };
        const result = await paginate(ComboGroup, req.query, null, filter);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getComboGroupById = async (req, res) => {
    try {
        const { groupId } = req.params;
        const comboGroup = await ComboGroup.findById(groupId).populate("vendor", "name _id storeDetails");

        if (!comboGroup) {
            return res
                .status(404)
                .json({ success: false, message: "Combo group not found" });
        }

        // Fetch combos associated with this group
        const combos = await Combo.find({ comboGroup: groupId }).populate({
            path: "selections.items.item",
            select: "name img description price"
        });

        res.status(200).json({
            success: true,
            data: {
                ...comboGroup.toObject(),
                combos
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const manageGroupItems = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { add, remove } = req.body; // Arrays of combo IDs

        const comboGroup = await ComboGroup.findById(groupId).populate("vendor");

        if (!comboGroup) {
            return res
                .status(404)
                .json({ success: false, message: "Combo group not found" });
        }

        if (!comboGroup.vendor.owner.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to manage this combo group",
            });
        }

        const session = await Combo.startSession();
        session.startTransaction();

        try {
            if (add && add.length > 0) {
                // Remove duplicates from input
                const uniqueAdd = [...new Set(add)];

                // Verify combos belong to same vendor
                const combosToAdd = await Combo.find({ _id: { $in: uniqueAdd } }).session(session);

                if (combosToAdd.length !== uniqueAdd.length) {
                    throw new Error("One or more combos not found");
                }

                const invalidCombos = combosToAdd.filter(c => !c.vendor.equals(comboGroup.vendor._id));

                if (invalidCombos.length > 0) {
                    throw new Error("Cannot add combos from different vendor");
                }

                await Combo.updateMany(
                    { _id: { $in: uniqueAdd } },
                    { $set: { comboGroup: groupId } },
                    { session }
                );
            }

            if (remove && remove.length > 0) {
                // Verify combos belong to same vendor (security check)
                // Although removing them just sets to null, strictly speaking only owner should do this.
                // The query filters by ID, so if they don't exist/aren't owned, nothing happens or we could iterate check.
                // For now, simple update.
                await Combo.updateMany(
                    { _id: { $in: remove }, vendor: comboGroup.vendor._id }, // Ensure vendor owns them
                    { $unset: { comboGroup: "" } },
                    { session }
                );
            }

            await session.commitTransaction();
            session.endSession();

            res.status(200).json({
                success: true,
                message: "Group items updated successfully",
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createComboGroup,
    updateComboGroup,
    deleteComboGroup,
    getVendorComboGroups,
    getMyComboGroups, // Added for vendor to see their own groups easily
    getComboGroupById,
    manageGroupItems,
};
