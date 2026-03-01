const mongoose = require("mongoose");
const Plate = require("./Plate");
const FoodItem = require("./FoodItem");
const Dish = require("./Combo");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");

const orderSchema = new mongoose.Schema(
	{
		customer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Customer",
			required: true,
		},
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "VendorProfile",
			required: true,
		},
		items: [
			new mongoose.Schema(
				{
					itemType: {
						type: String,
						enum: ["FoodItem", "Combo", "Plate"],
						required: true,
					},
					item: {
						type: mongoose.Schema.Types.ObjectId,
						required: true,
						refPath: "items.itemType", // Dynamic reference
					},
					subCategoryItemId: {
						type: mongoose.Schema.Types.ObjectId,
						default: null, // only required when itemType is FoodItem
					},
					comboSelections: {
						type: [
							{
								groupId: { type: mongoose.Schema.Types.ObjectId },
								groupName: String,
								items: [
									{
										itemId: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" },
										name: String,
										price: Number,
										quantity: { type: Number, default: 1 },
									},
								],
							},
						],
						default: undefined,
					},
					quantity: {
						type: Number,
						default: 1,
						min: 1,
					},
					price: {
						type: Number,
						required: true,
					},
					notes: String, // optional instructions
				},
				{ _id: false }, // Disable automatic _id for subdocuments
			),
		],
		totalPrice: {
			type: Number,
			required: true,
		},
		deliveryFee: {
			type: Number,
			required: true,
		},
		zone: {
			type: String,
		}, // e.g., "Ikeja"
		deliveryLatitude: Number,
		deliveryLongitude: Number,
		rider: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "RiderProfile",
		},
		status: {
			type: String,
			enum: Object.values(ORDER_STATUS),
			default: ORDER_STATUS.CONFIRMING,
		},
		subStatus: {
			type: String,
			enum: Object.values(ORDER_SUB_STATUS),
			default: ORDER_SUB_STATUS.CONFIRMING,
		},
		deliveryAddress: {
			type: String,
		},

		// Delivery OTP & confirmation (in-app flow)
		deliveryOtpCode: String,
		deliveryOtpHash: String,
		deliveryOtpSentAt: Date,
		deliveryOtpExpiresAt: Date,
		deliveryConfirmedAt: Date,
		deliveryConfirmedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "RiderProfile",
		},

		paymentStatus: {
			type: String,
			enum: ["unpaid", "paid", "refunded"],
			default: "unpaid",
		},

		// Vendor decline fields (happens during confirmation stage)
		declinedAt: Date,
		declinedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User", // Vendor user ID
		},
		declineReason: {
			type: String,
			enum: [
				"vendor_out_of_stock",
				"vendor_too_busy",
				"vendor_kitchen_closed",
				"vendor_delivery_area_not_covered",
				"vendor_technical_issue",
				"vendor_item_unavailable",
				"vendor_prep_time_too_long",
				"vendor_other",
			],
		},
		declineNote: {
			type: String,
			maxlength: 500,
		},

		// Cancellation fields (happens after order is accepted)
		cancelledAt: Date,
		cancelledBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
		},
		cancellationReason: {
			type: String,
			enum: [
				// Customer reasons
				"customer_changed_mind",
				"customer_ordered_by_mistake",
				"customer_long_wait_time",
				"customer_found_alternative",
				"customer_delivery_address_issue",
				"customer_payment_issue",
				"customer_other",

				// Vendor reasons (after accepting)
				"vendor_out_of_stock",
				"vendor_too_busy",
				"vendor_cannot_fulfill",
				"vendor_technical_issue",
				"vendor_other",

				// Rider reasons
				"rider_cannot_reach_vendor",
				"rider_cannot_reach_customer",
				"rider_vehicle_issue",
				"rider_other",

				// System reasons
				"system_no_rider_available",
				"system_payment_failed",
				"system_timeout",
				"system_other",
			],
		},
		cancellationNote: {
			type: String,
			maxlength: 500,
		},
		cancellationCategory: {
			type: String,
			enum: ["customer", "vendor", "rider", "system"],
		},
	},
	{
		timestamps: true,
	},
);

// Indexes for performance
orderSchema.index({ customer: 1, status: 1 });
orderSchema.index({ vendor: 1, status: 1 });
orderSchema.index({ rider: 1, status: 1 });
orderSchema.index({ status: 1, subStatus: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ cancelledAt: -1 });
orderSchema.index({ declinedAt: -1 });
orderSchema.index({ zone: 1 });

// Virtual for decline details
orderSchema.virtual("declineDetails").get(function () {
	if (!this.declinedAt) return null;

	return {
		declinedAt: this.declinedAt,
		declinedBy: this.declinedBy,
		reason: this.declineReason,
		note: this.declineNote,
	};
});

// Virtual for cancellation details
orderSchema.virtual("cancellationDetails").get(function () {
	if (!this.cancelledAt) return null;

	return {
		cancelledAt: this.cancelledAt,
		cancelledBy: this.cancelledBy,
		reason: this.cancellationReason,
		note: this.cancellationNote,
		category: this.cancellationCategory,
	};
});

orderSchema.set("toJSON", {
	virtuals: true,
	versionKey: false,
	transform: function (doc, ret) {
		delete ret._id;
		if (ret.items && Array.isArray(ret.items)) {
			ret.items.forEach((item) => {
				delete item._id;
			});
		}
	},
});

module.exports = mongoose.model("Order", orderSchema);
