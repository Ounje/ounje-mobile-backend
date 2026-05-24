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
										itemId: {
											type: mongoose.Schema.Types.ObjectId,
											ref: "FoodItem",
										},
										name: String,
										price: Number,
										quantity: { type: Number, default: 1 },
									},
								],
							},
						],
						default: undefined,
					},
					name: {
						type: String, // snapshot of item display name at time of order
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
		orderNumber: { type: String, unique: true, sparse: true },
		totalPrice: {
			type: Number,
			required: true,
		},
		deliveryFee: {
			type: Number,
			required: true,
		},
		serviceFee: {
			type: Number,
			default: 0,
		},
		foodTotal: { type: Number, default: 0 }, // gross food subtotal (sum of items)
		vendorEarning: { type: Number, default: 0 }, // net to vendor after platform commission
		comboMarkupRevenue: { type: Number, default: 0 }, // extra 30% collected from non-promo combo orders
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

		paymentMethod: {
			type: String,
			enum: ["paystack", "wallet"],
		},

		isPreorder: { type: Boolean, default: false },
		preparationTime: { type: String },
		scheduledFor: { type: Date }, // null = immediate order; set = scheduled delivery time

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

		// Rider delivery report (submitted from ride history screen)
		riderReport: {
			reportedAt: Date,
			reportedBy: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "RiderProfile",
			},
			note: {
				type: String,
				maxlength: 1000,
			},
		},
	},
	{
		timestamps: true,
	},
);

// Pre-validate hook to normalize "assigned" to "riding"
orderSchema.pre("validate", function (next) {
	if (this.status === "assigned") {
		this.status = "riding";
	}
	next();
});

// Pre-update hooks to normalize "assigned" to "riding"
orderSchema.pre(["update", "updateOne", "updateMany", "findOneAndUpdate"], function (next) {
	const update = this.getUpdate();
	if (update) {
		if (update.status === "assigned") {
			update.status = "riding";
		}
		if (update.$set && update.$set.status === "assigned") {
			update.$set.status = "riding";
		}
	}
	next();
});

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
