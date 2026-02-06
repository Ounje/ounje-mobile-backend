# Standard Food Delivery Schema Examples

This document illustrates the data structure for a standard, scalable food delivery application. It moves away from rigid types (like separate `Plate` or `Combo` collections) and uses flexible, unified structures.

## 1. Authentication & Identity (`users`)

**Scenario:** A user who is both a Customer and has signed up to be a Rider.

```json
{
  "_id": "user_123456789",
  "email": "john.doe@example.com",
  "phone": "+2348012345678",
  "passwordHash": "$2b$10$...",
  "roles": ["customer", "rider"],
  "isVerified": true,
  "createdAt": "2024-02-05T10:00:00Z",
  "lastLogin": "2024-02-05T12:30:00Z"
}
```

---

## 2. Profiles (Role-Specific Data)

### Customer Profile (`customers`)
```json
{
  "_id": "cust_123",
  "user": "user_123456789",
  "firstName": "John",
  "lastName": "Doe",
  "savedAddresses": [
    {
      "label": "Home",
      "address": "123 Lagos St, Ikeja",
      "coordinates": [3.3792, 6.5244], // [Longitude, Latitude]
      "details": "Apt 4B"
    }
  ],
  "preferences": {
    "marketingEmails": true
  }
}
```

### Rider Profile (`riders`)
```json
{
  "_id": "rider_987",
  "user": "user_123456789",
  "status": "available", // offline, available, busy
  "currentLocation": {
    "type": "Point",
    "coordinates": [3.3800, 6.5250]
  },
  "vehicle": {
    "type": "motorcycle",
    "plateNumber": "KJA-123-XY",
    "model": "Bajaj Boxer"
  },
  "earnings": {
    "today": 5000,
    "week": 25000
  },
  "ratings": {
    "average": 4.8,
    "count": 150
  }
}
```

### Vendor Example A: Preorder Vendor (`vendors`)
**Description:** A caterer or bakery requiring advance notice.

```json
{
  "_id": "vendor_555",
  "owner": "user_999888777",
  "name": "Mama Put Delight",
  "slug": "mama-put-delight",
  "description": "Authentic local dishes delivered hot.",
  "logoUrl": "https://bucket/logo.png",
  "bannerUrl": "https://bucket/banner.png",
  "rating": 4.5,
  "isActive": true,
  "location": {
    "type": "Point",
    "coordinates": [3.3500, 6.5000]
  },
  // FULFILLMENT SETTINGS (Preorder)
  "fulfillmentSettings": {
    "type": "preorder",
    "minLeadTimeHours": 24, // Must order 24 hours in advance
    "maxDaysInAdvance": 7,  // Can order up to 7 days out
    "slots": { 
      "intervalMinutes": 60, // Delivery/Pickup slots are hourly
      "capacityPerSlot": 5   // Max 5 orders per hour
    }
  },
  "operatingHours": [
    { "day": "monday", "open": "08:00", "close": "20:00", "isClosed": false },
    { "day": "sunday", "open": "00:00", "close": "00:00", "isClosed": true }
  ]
}
```

### Vendor Example B: On-Demand Vendor (`vendors`)
**Description:** A standard fast-food restaurant (e.g., Burger King).

```json
{
  "_id": "vendor_777",
  "owner": "user_111222333",
  "name": "Quick Burger",
  "slug": "quick-burger-ikeja",
  "description": "Best burgers in town, delivered in minutes.",
  "logoUrl": "https://bucket/burger_logo.png",
  "rating": 4.2,
  "isActive": true,
  "location": {
    "type": "Point",
    "coordinates": [3.3600, 6.5100]
  },
  // FULFILLMENT SETTINGS (On-Demand)
  "fulfillmentSettings": {
    "type": "on_demand",
    "preparationTimeMin": 20, // Average prep time for algorithm
    "autoAcceptOrders": true, // Automatically confirm incoming orders
    "minOrderAmount": 1000
  },
  "operatingHours": [
    { "day": "monday", "open": "10:00", "close": "22:00", "isClosed": false },
    { "day": "sunday", "open": "12:00", "close": "22:00", "isClosed": false }
  ]
}
```

---

## 3. The Menu (`products`)

Instead of separate `Plate` and `Combo` collections, we use a unified `Product` model with `ModifierGroups` to handle choices.

### Example A: Simple Item (Jollof Rice)
```json
{
  "_id": "prod_001",
  "vendor": "vendor_555",
  "name": "Jollof Rice",
  "description": "Smoky party jollof",
  "price": 1500,
  "imageUrl": "https://bucket/jollof.jpg",
  "type": "item",
  "isAvailable": true,
  "modifierGroups": [
    {
      "name": "Add Protein",
      "minSelection": 0,
      "maxSelection": 2,
      "options": [
        { "name": "Fried Beef", "priceDelta": 500 },
        { "name": "Chicken", "priceDelta": 800 }
      ]
    }
  ]
}
```

### Example B: "Combo" / "Plate" (Full Meal Deal)
*A "plate" is just a product that requires you to make choices (sides, drinks).*

```json
{
  "_id": "prod_002",
  "vendor": "vendor_555",
  "name": "Big Boy Combo",
  "description": "Rice choice + 2 Proteins + Drink",
  "price": 3500,
  "type": "combo",
  "modifierGroups": [
    {
      "name": "Choose Rice Base",
      "minSelection": 1,
      "maxSelection": 1,
      "options": [
        { "name": "Jollof Rice", "priceDelta": 0 },
        { "name": "Fried Rice", "priceDelta": 0 }
      ]
    },
    {
      "name": "Choose Proteins",
      "minSelection": 2,
      "maxSelection": 2,
      "options": [
        { "name": "Chicken Leg", "priceDelta": 0 },
        { "name": "Asun", "priceDelta": 200 } // Extra charge for Asun
      ]
    },
    {
      "name": "Select Drink",
      "minSelection": 1,
      "maxSelection": 1,
      "options": [
        { "name": "Coke", "priceDelta": 0 },
        { "name": "Water", "priceDelta": 0 }
      ]
    }
  ]
}
```

---

## 4. Orders (`orders`)

The order is a **Snapshot**. It also handles **scheduling** for pre-order vendors.

```json
{
  "_id": "order_777",
  "customer": "user_123456789",
  "vendor": "vendor_555",
  "rider": null, // Assigned later for preorders
  "status": "scheduled", // 'scheduled', 'preparing', 'ready', 'delivering'
  
  // SCHEDULING INFO
  "orderType": "scheduled", // 'immediate' or 'scheduled'
  "scheduledFor": "2024-02-06T13:00:00Z", // The target delivery slot
  
  "items": [
    {
      "productId": "prod_002",
      "name": "Big Boy Combo",
      "quantity": 1,
      "unitPrice": 3500,
      "totalItemPrice": 3700, // 3500 + 200 (Asun extra)
      "selectedModifiers": [
        { "groupName": "Choose Rice Base", "optionName": "Jollof Rice", "price": 0 },
        { "groupName": "Choose Proteins", "optionName": "Chicken Leg", "price": 0 },
        { "groupName": "Choose Proteins", "optionName": "Asun", "price": 200 },
        { "groupName": "Select Drink", "optionName": "Coke", "price": 0 }
      ]
    }
  ],
  "financials": {
    "subtotal": 3700,
    "deliveryFee": 500,
    "serviceFee": 100,
    "discount": 0,
    "total": 4300
  },
  "deliveryLocation": {
    "address": "123 Lagos St, Ikeja",
    "coordinates": [3.3792, 6.5244]
  },
  "timestamps": {
    "placedAt": "2024-02-05T13:00:00Z",
    "confirmedAt": "2024-02-05T13:05:00Z"
  }
}
```

---

## 5. Financials (`ledger`)

We verify money movement using Double-Entry Bookkeeping.

**Scenario:** Customer pays 4300 for the order above.

**Transaction 1: Customer Payment (Inflow)**
```json
{
  "_id": "ledge_001",
  "transactionId": "tx_pay_order_777",
  "description": "Payment for Order #777",
  "entries": [
    { "account": "Assets:SystemBank", "debit": 4300, "credit": 0 },
    { "account": "Liabilities:CustomerWallet:user_123", "debit": 0, "credit": 4300 }
  ]
}
```

**Transaction 2: Order Allocation (Splitting the pot)**
*Assume Vendor gets 3700, Rider gets 500, System keeps 100.*
```json
{
  "_id": "ledge_002",
  "transactionId": "tx_alloc_order_777",
  "description": "Allocation for Order #777",
  "entries": [
    { "account": "Liabilities:CustomerWallet:user_123", "debit": 4300, "credit": 0 }, // Take money from pending customer hold
    { "account": "Liabilities:VendorWallet:vendor_555", "debit": 0, "credit": 3700 }, // Credit Vendor
    { "account": "Liabilities:RiderWallet:rider_987", "debit": 0, "credit": 500 },   // Credit Rider
    { "account": "Revenue:ServiceFees", "debit": 0, "credit": 100 }                    // Our Profit
  ]
}
```

---

## 6. Ratings & Reviews (`reviews`)

**Structure:**
```json
{
  "_id": "rev_999",
  "targetType": "vendor", // 'vendor', 'product', 'rider'
  "targetId": "vendor_555", // Reference to the entity being rated
  "author": "user_123456789", // The Customer
  "orderId": "order_777", // Verified purchase link
  "rating": 5, // 1-5 Stars
  "comment": "The Jollof was amazing!",
  "images": ["https://bucket/review_img.jpg"],
  "createdAt": "2024-02-06T14:00:00Z"
}
```

---

## 7. Organization (`categories`)

Don't hardcode categories. Store them to allow dynamic sorting.

```json
{
  "_id": "cat_001",
  "name": "Breakfast",
  "slug": "breakfast",
  "imageUrl": "https://bucket/breakfast.png",
  "sortOrder": 1,
  "isActive": true
}
```

---

## 8. Growth & Marketing (`promotions`)

For coupon codes (e.g., "WELCOME50").

```json
{
  "_id": "promo_100",
  "code": "WELCOME50",
  "description": "50% off your first order",
  "type": "percentage", // 'percentage', 'fixed_amount'
  "value": 50, // 50 percent
  "maxDiscount": 2000, // Capped at N2000
  "minOrderValue": 5000,
  "usageLimit": 1000,
  "startsAt": "2024-02-01T00:00:00Z",
  "expiresAt": "2024-03-01T00:00:00Z"
}
```

---

## 9. Support & Issues (`support_tickets`)

For handling refunds and complaints.

```json
{
  "_id": "tkt_555",
  "user": "user_123456789",
  "orderId": "order_777",
  "status": "open", // 'open', 'resolved', 'closed'
  "category": "missing_item",
  "description": "I didn't get my drink.",
  "messages": [
    {
      "sender": "user",
      "text": "Where is my coke?",
      "timestamp": "2024-02-06T14:15:00Z"
    },
    {
      "sender": "admin",
      "text": "Sorry! We are processing a refund.",
      "timestamp": "2024-02-06T14:20:00Z"
    }
  ]
}
```

---

## 10. Settlements (`payouts`)

Explicit records of money leaving your system to a bank account.

### Recipient Security
**Question:** Should we store `bankAccountNumbers`?
**Standard:** For *Receiving* money, storing the Account Number (NUBAN) + Bank Name is generally safe (it's public info), unlike Credit Car Numbers (PCI-DSS violation).
**Better:** However, the *best* practice is to offload this to your Payment Provider (Paystack/Flutterwave). You create a "Transfer Recipient" on their dashboard, and they give you a `recipient_code`. You store that code.

**How it works:**   
1.)You send the bank details to your Payment Provider (Paystack/Flutterwave) once.
2.)They give you a code like RCP_12345.
3.)You save RCP_12345 in your database.
4.)To pay the vendor, you simply tell the provider: "Send N50,000 to RCP_12345".

```json
{
  "_id": "payout_900",
  "recipientType": "vendor",
  "recipientId": "vendor_555",
  "amount": 50000,
  "status": "processed", // 'pending', 'processed', 'failed'
  
  // OPTION A: Stored Details (Acceptable for Payouts, NOT Payments)
  // "bankDetails": {
  //   "bankName": "GTBank",
  //   "accountNumber": "0123456789"
  // },

  // OPTION B: Tokenized (Best Practice)
  "providerRecipientCode": "RCP_gx2wn530m5", 
  "reference": "ref_bank_transfer_xyz",
  "processedAt": "2024-02-07T09:00:00Z"
}
```

---

## 11. Utility & Transient Models (Auth & Ops)

### OTP Verification (`otps`) or (`identities`)
Used for passwordless sign-in or 2FA.
*Best Practice:* Set a MongoDB TTL index on `expiresAt` so they auto-delete.
```json
{
  "_id": "otp_888",
  "identifier": "+2348012345678", // Phone or Email
  "codeHash": "$2b$10$...", // Always hash OTPs!
  "purpose": "login", // 'login', 'verify_phone'
  "expiresAt": "2024-02-06T14:05:00Z" // TTL Index here
}
```

### Refresh Tokens (`refresh_tokens`)
```json
{
  "_id": "rt_777",
  "user": "user_123456789",
  "tokenHash": "...",
  "expiresAt": "2024-02-13T10:00:00Z",
  "isRevoked": false,
  "deviceInfo": "iPhone 13 - Lagos"
}
```

### Announcements / Newsflash (`announcements`)
Replaces "Newsflash". Used for global alerts (e.g., "Heavy Rain affecting deliveries").
```json
{
  "_id": "ann_123",
  "title": "Rain Alert",
  "message": "Deliveries may be delayed due to heavy rain in Ikeja.",
  "targetRoles": ["rider", "customer"], // Who sees this?
  "isActive": true,
  "expiresAt": "2024-02-06T18:00:00Z"
}
```

---

## 12. Models You DO NOT Need (Anti-patterns)

### ❌ `RiderEarnings` (Separate Collection)
**Standard Approach:**
Do not create a separate collection for earnings.
*   **Why?** It duplicates data from `Ledger` or `Orders`. If you update one and forget the other, your financial data is wrong.
*   **Solution:** Calculate earnings on the fly from the `Ledger` (e.g., `Sum of all Credits to RiderWallet`) OR cache a summary inside the `Rider` profile (e.g., `rider.earnings.weekVal`).

### ❌ `VendorSettlement` (Separate from Payouts)
**Standard Approach:**
Use `Payouts`.
*   **Why?** "Settlement" usually implies the calculation of what is owed. The `Ledger` tells you what is owed. `Payouts` tracks the actual bank transfer. You don't need a third thing in between.
