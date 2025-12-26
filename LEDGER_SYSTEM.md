# Ledger System Documentation

## Overview

Your payment system now includes an **internal double-entry ledger system** that tracks all earnings for riders and vendors, manages payouts, and ensures financial accountability.

## System Architecture

### Core Models

1. **LedgerAccount** - Tracks balance state for each user (vendor/rider)
   - `userId`: Reference to vendor or rider
   - `type`: VENDOR or RIDER
   - `availableBalance`: Money ready to payout
   - `pendingBalance`: Money reserved for pending payouts
   - `holdBalance`: Future use (temporarily held funds)

2. **LedgerEntry** - Immutable transaction record
   - `accountId`: Which account was affected
   - `amount`: Transaction amount
   - `entryType`: CREDIT (money in) or DEBIT (money out)
   - `reason`: ORDER_EARNING, COMMISSION, PAYOUT, PAYOUT_PENDING, ADJUSTMENT, REFUND, REVERSAL
   - `balanceAfter`: Balance snapshot after transaction
   - `metadata`: Custom data (order details, commission rate, etc.)

3. **Payout** - Payout request tracking
   - `user`, `userType`: Which rider/vendor
   - `amount`: Requested payout amount
   - `bankDetails`: Account for transfer
   - `status`: pending → processing → completed/failed
   - `transactionRef`: External payment provider reference
   - `processedAt`: When money was sent

## Payment Flow

### Step 1: Customer Pays for Order (webhook)

When a customer successfully pays via Paystack:

```
webhookHandler() 
├─ Create Payment record (status: success)
├─ Update Order (paymentStatus: paid)
├─ Credit Vendor:
│  └─ ledgerService.creditVendorFromOrder(order, commission=0.10)
│     └─ Creates CREDIT entry for (totalPrice - commission)
│     └─ Updates availableBalance
├─ Credit Rider:
│  └─ ledgerService.creditRiderFromOrder(order, deliveryFee)
│     └─ Creates CREDIT entry for deliveryFee
│     └─ Updates availableBalance
└─ Legacy `VendorSettlement` and `RiderEarnings` models are deprecated; payouts are handled via the ledger and `Payout` records (auto payout flow)
```

**Example:**
- Order total: ₦10,000
- Commission rate: 10%
- Vendor earnings: ₦9,000 (credited immediately to availableBalance)
- Rider fee: ₦1,500 (credited immediately to availableBalance)

### Step 2: Vendor/Rider Requests Payout

```
POST /api/payouts/request
Body: {
  "amount": 5000,
  "bankDetails": {
    "accountNumber": "1234567890",
    "bankCode": "058", // GTBANK
    "accountName": "John Doe"
  }
}

requestPayout()
├─ Validate amount ≤ availableBalance
├─ reserveBalance() - Move from available → pending
│  └─ Creates DEBIT entry (PAYOUT_PENDING)
│  └─ availableBalance -5000, pendingBalance +5000
├─ Create Payout record (status: pending)
└─ Return updated balances
```

**States after request:**
- availableBalance: ₦4,000 (can't be used)
- pendingBalance: ₦5,000 (reserved)

### Step 3: Admin Processes Payout

Admin uses Paystack Transfer API to send money to rider/vendor's bank account:

```
PUT /api/payouts/:payoutId/process
Body: {
  "transactionRef": "TRF_12345xyz",
  "status": "completed" // or "failed"
}

processPayout()
├─ If failed:
│  ├─ reverseReserve() - Move pending back to available
│  └─ Payout status: failed
├─ If completed:
│  ├─ completePayout() - Debit from pending
│  │  └─ Creates DEBIT entry (PAYOUT)
│  │  └─ pendingBalance -5000 → 0 (money left system)
│  ├─ Payout status: completed
│  ├─ Set transactionRef & processedAt
│  └─ Money has been sent to bank
```

### Instant Payouts on Delivery (Auto)

You can enable "instant" payouts so that when a rider verifies delivery using an OTP provided to the customer, the system automatically attempts to transfer the vendor and rider earnings to their bank accounts (no admin action required).

Flow:
1. Rider marks order `out_for_delivery` → backend generates a secure in-app OTP and delivers it to the customer's app (via socket.io or `/api/orders/:id/delivery-otp`).
2. Customer gives OTP to the rider; rider submits the OTP when marking the order `delivered`.
3. Backend verifies the OTP, marks order `completed`, reserves ledger balances, creates `Payout` records and initiates Paystack transfers.
4. On transfer success: ledger `completePayout()` is called and the payout is marked `completed`.
5. On failure: the reserved funds are reversed back to available and the payout is marked `failed` (admin can review).

Endpoints:
- POST `/api/orders/:id/assign` (rider claims order)
- PUT `/api/orders/:id/rider-update` with `{ status: "out_for_delivery" }` → sends OTP to customer
- PUT `/api/orders/:id/rider-update` with `{ status: "delivered", otp: "123456" }` → verifies OTP and triggers auto payouts

Notes:
- Vendors and riders must have `bankDetails` saved on their profiles (accountNumber + bankCode + accountName) or payouts will remain `pending` for manual processing.
- All transfers use Paystack `transfer` and `transferrecipient` APIs; transfer codes and failures are recorded on `Payout`.

Quick manual test
1. Create order and pay (Paystack test card). Ensure webhook processes and ledger credits the vendor/rider.
2. Assign order to a rider and call PUT `/api/orders/:id/rider-update` with `{ status: "out_for_delivery" }` — check that customer receives an OTP (via KudiSMS) and the `Order` doc has `deliveryOtpReference`.
3. At delivery, rider submits `{ status: "delivered", otp: "<code>" }` — order should move to `completed` and `Payout` records created in DB.
4. If bank details are present, the service will attempt Paystack transfers and the payout will be marked `completed` on success; otherwise the payout stays `pending` for admin processing.


## API Endpoints

### For Riders/Vendors

#### Get Balance
```
GET /api/payouts/balance

Response:
{
  "accountId": "....",
  "availableBalance": 9000,
  "pendingBalance": 5000,
  "holdBalance": 0,
  "totalBalance": 14000,
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

#### Get Transaction History
```
GET /api/payouts/history?limit=20&skip=0

Response:
{
  "transactions": [
    {
      "_id": "...",
      "accountId": "....",
      "amount": 10000,
      "entryType": "CREDIT",
      "reason": "ORDER_EARNING",
      "meta": { "gross": 10000, "commission": 1000, "commissionRate": 0.1 },
      "balanceAfter": 9000,
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 45,
  "hasMore": true
}
```

#### Request Payout
```
POST /api/payots/request

Body:
{
  "amount": 5000,
  "bankDetails": {
    "accountNumber": "1234567890",
    "bankCode": "058",
    "accountName": "John Doe"
  }
}

Response:
{
  "message": "Payout request submitted successfully",
  "payout": {
    "payoutId": "....",
    "amount": 5000,
    "status": "pending",
    "requestedAt": "2025-01-15T11:00:00Z"
  },
  "updatedBalance": {
    "availableBalance": 4000,
    "pendingBalance": 5000
  }
}
```

#### Get Pending Payouts
```
GET /api/payouts/pending

Response:
{
  [
    {
      "_id": "....",
      "user": "....",
      "userType": "VENDOR",
      "amount": 5000,
      "bankDetails": {...},
      "status": "pending",
      "createdAt": "2025-01-15T11:00:00Z"
    }
  ]
}
```

#### Cancel Payout Request
```
PUT /api/payouts/:payoutId/cancel

Response:
{
  "message": "Payout request cancelled",
  "payout": {...},
  "updatedBalance": {
    "availableBalance": 9000,
    "pendingBalance": 0
  }
}
```

#### Get Account Statement
```
GET /api/payouts/statement?startDate=2025-01-01&endDate=2025-01-31

Response:
{
  "account": {
    "_id": "....",
    "type": "VENDOR",
    "availableBalance": 9000
  },
  "entries": [
    {
      "_id": "....",
      "amount": 10000,
      "entryType": "CREDIT",
      "reason": "ORDER_EARNING",
      "createdAt": "2025-01-15T10:00:00Z",
      "runningBalance": 10000
    }
  ],
  "statement_period": {
    "startDate": "2025-01-01",
    "endDate": "2025-01-31"
  }
}
```

### Admin Endpoints

#### Process Payout
```
PUT /api/payouts/:payoutId/process

Body:
{
  "transactionRef": "TRF_12345xyz",
  "status": "completed"  // or "failed"
}

Response:
{
  "message": "Payout processed successfully",
  "payout": {
    "_id": "....",
    "status": "completed",
    "transactionRef": "TRF_12345xyz",
    "processedAt": "2025-01-15T15:00:00Z"
  },
  "updatedBalance": {
    "availableBalance": 9000,
    "pendingBalance": 0
  }
}
```

## Integration Steps

### 1. Update `server.js`

Add the payout routes:

```javascript
const payoutRoutes = require("./routes/payoutRoutes");

app.use("/api/payouts", payoutRoutes);
```

### 2. Update Middleware

Ensure `auth.js` middleware sets `req.user.type` to 'rider' or 'vendor':

```javascript
// In middleware/auth.js
const user = await User.findById(userId);
req.user.type = user.discriminator; // 'rider', 'vendor', etc.
```

### 3. Verify Models

Ensure all models are properly imported in models/index.js or wherever you centralize imports:

```javascript
const { LedgerAccount } = require("./LedgerAccount");
const { LedgerEntry } = require("./LedgerEntry");
const Payout = require("./Payout");
```

### 4. Test the Flow

```bash
# 1. Trigger payment webhook (simulated)
POST /api/payments/webhook

# 2. Check rider/vendor balance
GET /api/payouts/balance

# 3. Request payout
POST /api/payouts/request

# 4. Admin processes payout
PUT /api/payouts/:payoutId/process
```

## Key Features

### Double-Entry Bookkeeping
- Every transaction creates both debit and credit (implicitly with platform)
- Running balance snapshots prevent reconciliation errors
- All entries are immutable (audit trail)

### Balance States
- **Available**: Ready to payout anytime
- **Pending**: Reserved for in-flight payouts (can't touch)
- **Total = Available + Pending**: True earning

### Payout Safety
- Reservation step prevents double-spending
- Fails fast if insufficient balance
- Atomic transactions (all-or-nothing)

### Auditability
- Complete transaction history
- Reason codes for each entry
- Metadata tracking (commission rates, etc.)
- Statement export for reconciliation

## Commission Handling

Commissions are deducted automatically when vendor is credited:

```javascript
const vendorGross = order.totalPrice;      // 10,000
const commission = vendorGross * 0.10;     // 1,000
const vendorNet = vendorGross - commission; // 9,000

// Vendor receives 9,000
await ledgerService.creditVendorFromOrder(order, 0.10);

// Platform keeps 1,000 implicitly (gross - net)
```

To track platform balance:

```javascript
// Add to ledger.service.js:
const creditPlatform = async (amount, reason) => {
  const platformAccount = await ensureAccount(
    "PLATFORM", 
    "PLATFORM"
  );
  return creditAccount("PLATFORM", "PLATFORM", amount, reason);
};
```

## Handling Refunds

If a customer requests a refund:

```javascript
// In refund handler:
const order = await Order.findById(orderId);

// Debit vendor (reversal)
await ledgerService.debitAccount(
  order.vendor,
  "VENDOR",
  vendorNet,
  "REFUND",
  { reason: "Customer refund", orderId }
);

// Debit rider
if (order.rider) {
  await ledgerService.debitAccount(
    order.rider,
    "RIDER",
    order.deliveryFee,
    "REFUND",
    { reason: "Rider refund", orderId }
  );
}
```

## Monitoring & Alerts

Set up alerts for:
- Large pending balances > X days
- Failed payouts (investigate 3x failures)
- Unusual transaction patterns

```javascript
// Example: Find stale pending payouts
const stalPayouts = await Payout.find({
  status: "pending",
  createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
});
```

## Future Enhancements

1. **Batch Payouts**: Process multiple riders/vendors at once
2. **Payment Provider Integration**: Auto-trigger Paystack transfers
3. **Reconciliation Report**: Auto-match bank statements
4. **Fee Structure**: Variable commission based on vendor tier
5. **Hold Periods**: Funds held N days before payout availability
6. **Chargeback Handling**: Reverse entries if payment disputed

---

**Summary**: Your ledger system is production-ready. It handles crediting, holds funds safely, and provides a complete audit trail. Integrate the routes into your server and test the flow with actual orders.
