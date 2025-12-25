# API Routes Reference

This document shows how to call every Express router in `ounje-backend/routes` as mounted in `server.js`.

Base mounts (from `server.js`):

- `/api/auth` -> `authRoutes.js`
- `/api/food` and `/api/dishes` -> `dishRoutes.js` (both mount the same router)
- `/api/orders` -> `orderRoutes.js`
- `/api/payments` -> `paymentRoutes.js`
- `/api/vendors` -> `vendorRoutes.js`
- `/api/customers` -> `customerRoutes.js`
- `/api/plates` -> `plateRoutes.js`
- `/api/payouts` -> `payoutRoutes.js`

Files that exist but are not mounted in `server.js` by default:

- `adminRoutes.js` (not mounted) — path not configured in `server.js`.
- `testRoutes.js` (commented out in `server.js`).
- `webhookRoutes.js` (not mounted; payment webhooks are handled inside `paymentRoutes.js`).
- `ratingsRoutes.js` (not mounted).

Authentication note
- Endpoints that include `authMiddleware` require an `Authorization: Bearer <token>` header.
- Endpoints that use `roleGuard([...])` require the authenticated user to have the given role(s).

Examples use `curl`. Replace `HOST` with your server host (e.g. `http://localhost:5000`).

**Auth (`/api/auth`)**

- POST `/api/auth/register`
  - Body: JSON
  - Example:
    ```bash
    curl -X POST "HOST/api/auth/register" -H "Content-Type: application/json" \
      -d '{"name":"Alice","phone":"08012345678","role":"customer"}'
    ```

- POST `/api/auth/login`
  - Body: JSON (phone/email + password or strategy used by your controller)
  - Example:
    ```bash
    curl -X POST "HOST/api/auth/login" -H "Content-Type: application/json" \
      -d '{"phone":"08012345678","password":"secret"}'
    ```

- POST `/api/auth/request-otp`
  - Body: JSON { phone }

- POST `/api/auth/verify-otp`
  - Body: JSON { phone, code }

- POST `/api/auth/logout`
  - Body: JSON (refresh token expected by controller)

- POST `/api/auth/refresh`
  - Body: JSON (contains refresh token)

**Dish / Food (`/api/food` and `/api/dishes`)**

- POST `/api/food/create-dish`
  - Auth required (vendor role).
  - multipart/form-data; file field name: `file`.
  - Example:
    ```bash
    curl -X POST "HOST/api/food/create-dish" \
      -H "Authorization: Bearer <token>" \
      -F "file=@/path/to/image.jpg" \
      -F "name=Jollof" -F "description=..." -F "price=1500"
    ```

- POST `/api/food/create-food-item`
  - Auth required.
  - multipart/form-data with `file` and fields (`name`, `price`, ...)

- GET `/api/food/food-items`
  - Public: returns food items list.

- GET `/api/food/food-item/:foodItemId`
  - Public: retrieve specific food item.

- GET `/api/food/food-category/:category`
  - Public: list items by category.

- GET `/api/food/` and `/api/dishes/`
  - Public: list dishes.

- GET `/api/food/dish/:dishId`
  - Public: get dish by id.

- PUT `/api/food/dish/:dishId`
  - Auth + `roleGuard(["vendor"])` required.
  - Body: JSON with updated fields.

- DELETE `/api/food/dish/:dishId`
  - Auth + `roleGuard(["vendor"])` required.

- DELETE `/api/food/food-item/:foodItemId`
  - Auth + `roleGuard(["vendor"])` required.

**Orders (`/api/orders`)**

Customer endpoints (require auth + `customer` role):

- POST `/api/orders/`
  - Create order. Body: JSON order payload.
  - Example:
    ```bash
    curl -X POST "HOST/api/orders" \
      -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
      -d '{"items":[{"item":"<dishId>","qty":2}],"address":"..."}'
    ```

- GET `/api/orders/`
  - List current customer's orders.

- GET `/api/orders/:id`
  - Get single order (customer must own it).

- PUT `/api/orders/:id`
  - Customer update (cancel etc.). Body: JSON.

Seller endpoints (require auth + `seller` role):

- GET `/api/orders/seller`
  - List orders for vendor (populates user & items).

- PUT `/api/orders/:id/status`
  - Update order status (seller). Body: { status: "confirmed" | "cancelled" }

Rider endpoints (require auth + `rider` role):

- GET `/api/orders/available`
  - List confirmed unassigned orders.

- POST `/api/orders/:id/assign`
  - Claim an order as rider.

- PUT `/api/orders/:id/rider-update`
  - Update rider status / location. Body: { status, riderLocation: { lat, lng } }
  - To notify pickup and send delivery OTP: `{ "status": "out_for_delivery" }`
  - To confirm delivery & trigger auto payouts: `{ "status": "delivered", "otp": "123456" }`

- GET `/api/orders/rider`
  - Get the rider's own orders.

**Payments (`/api/payments`)**

- POST `/api/payments/initiate`
  - Auth + `customer` role required.
  - Body: JSON { amount, orderId, ... }

- GET `/api/payments/verify`
  - Public GET used for payment verification (query params expected by controller).

- POST `/api/payments/webhook`
  - Webhook endpoint for payment provider notifications. The controller handles verification.

**Vendors (`/api/vendors`)**

- GET `/api/vendors/popular`
  - Public: list popular vendors.

- GET `/api/vendors/profile`
  - Auth required: get vendor profile for logged-in vendor.

- GET `/api/vendors/vendor/:id`
  - Public: get vendor by id.

**Customers (`/api/customers`)**

- GET `/api/customers/profile`
  - Auth required: get logged-in customer profile.

**Plates (`/api/plates`)**

- POST `/api/plates/build-plate`
  - Auth required. multipart/form-data. file field: `file`.

- GET `/api/plates/get-plates`
  - Public: list plates.

- GET `/api/plates/plate/:plateId`
  - Public: get single plate.

- DELETE `/api/plates/plate/:plateId`
  - Auth + `roleGuard(["customer"])` required.

**Payouts (`/api/payouts`)**

- All endpoints require authentication.

- GET `/api/payouts/balance` — get current balance.

- GET `/api/payouts/history` — transaction history.

- GET `/api/payouts/pending` — pending payouts.

- GET `/api/payouts/statement` — account statement.

- POST `/api/payouts/request` — request a payout. Body: JSON.

- PUT `/api/payouts/:payoutId/cancel` — cancel a payout.

- PUT `/api/payouts/:payoutId/process` — process a payout (admin/operator).

**Admin routes (file exists: `adminRoutes.js`)**

- POST `/api/admin/create-platform-account` (not mounted in `server.js`) — creates platform account. If you want to use these routes, mount `adminRoutes` in `server.js` (e.g. `app.use('/api/admin', require('./routes/adminRoutes'))`).

- POST `/api/admin/login` (not mounted) — admin login.

**Other route files & comments**

- `testRoutes.js` contains numerous utility/test endpoints (image uploads, seeding, bulk ops). This router is commented out in `server.js`.
- `webhookRoutes.js` has a `/paystack` endpoint but it is not mounted. Payment webhooks are already handled in `paymentRoutes.js` via `/api/payments/webhook`.
- `ratingsRoutes.js` has a couple of routes (e.g. POST `vendor/:vendorId/rate`) but it's not mounted — if you plan to use it, mount it in `server.js`.

Quick tips

- To call an authenticated route, include header: `Authorization: Bearer <accessToken>`.
- File upload endpoints use `-F "file=@/path/to/file"` and the same field names as used in the route (e.g., `file`).
- When a route uses `express.json({ type: '*/*' })` (example: some webhooks), the raw body signature may be required to verify the provider's signature — do not reformat or alter the request body.

If you'd like, I can:

- add example JSON request bodies for each endpoint (based on controllers),
- generate a Postman collection or OpenAPI spec from these routes,
- or mount the missing routers in `server.js` and update this doc automatically.

---
Generated from routes in `ounje-backend/routes` and mounts in `ounje-backend/server.js`.

**Example Request Bodies**

Below are concise example JSON request bodies (or multipart examples) for the most commonly used endpoints. Use these as a starting point and adapt fields to suit your client.

- Register (POST `/api/auth/register`) — Body (JSON):

```json
{
  "name": "Alice",
  "role": "customer",     
  "location": "12 Some St, City",
  "phone": "08012345678",
  "otpSession": "<otpSession JWT returned by /verify-otp>",
  "operatingArea": "Optional for riders/vendors"
}
```

- Login (POST `/api/auth/login`) — Body (JSON):

```json
{
  "email": "alice@example.com"
}
```

- Request OTP (POST `/api/auth/request-otp`) — Body (JSON):

```json
{
  "email": "alice@example.com"
}
```

- Verify OTP (POST `/api/auth/verify-otp`) — Body (JSON):

```json
{
  "email": "alice@example.com",
  "otp": "1234"
}
```

- Logout (POST `/api/auth/logout`) — Body (JSON):

```json
{
  "refreshToken": "<refresh token returned on login/register>"
}
```

- Refresh (POST `/api/auth/refresh`) — Body (JSON):

```json
{
  "refreshToken": "<refresh token>"
}
```

- Create Dish (POST `/api/food/create-dish`) — multipart/form-data (fields + file):

Use `-F` when using `curl`.

```bash
curl -X POST "HOST/api/food/create-dish" \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/image.jpg" \
  -F "name=Jollof Rice" \
  -F "description=Delicious" \
  -F "category=Main Course" \
  -F "price=1500"
```

- Create Food Item (POST `/api/food/create-food-item`) — multipart/form-data:

```bash
curl -X POST "HOST/api/food/create-food-item" \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/image.jpg" \
  -F "name=Big Agege Bread" \
  -F "category=Bread" \
  -F "price=900" \
  -F "description=Freshly baked"
```

- Create Order (POST `/api/orders`) — Body (JSON):

```json
{
  "vendorId": "<vendorObjectId>",
  "deliveryAddress": "12 Some St, City",
  "items": [
    { "itemId": "<foodItemOrDishOrPlateId>", "itemType": "FoodItem", "quantity": 2 },
    { "itemId": "<plateId>", "itemType": "Plate", "quantity": 1 }
  ]
}
```

- Update Order (PUT `/api/orders/:id`) — Body (JSON) for customers (e.g., cancel):

```json
{
  "status": "cancelled"
}
```

- Update Order Status (PUT `/api/orders/:id/status`) — Body (JSON) for sellers:

```json
{
  "status": "confirmed"  // or "cancelled"
}
```

- Rider assign (POST `/api/orders/:id/assign`) — no body required (uses auth/rider id).

- Rider update (PUT `/api/orders/:id/rider-update`) — Body (JSON):

```json
{
  "status": "out_for_delivery", // or "delivered"
  "riderLocation": { "lat": 6.5244, "lng": 3.3792 }
}
```

- Initialise Payment (POST `/api/payments/initiate`) — Body (JSON):

```json
{
  "orderId": "<orderId>"
}
```

- Verify Payment (GET `/api/payments/verify?reference=<reference>`) — no JSON body; use query param `reference`.

- Request Payout (POST `/api/payouts/request`) — Body (JSON):

```json
{
  "amount": 5000,
  "bankDetails": {
    "accountNumber": "0123456789",
    "bankCode": "058",
    "accountName": "John Doe"
  }
}
```

- Cancel Payout (PUT `/api/payouts/:payoutId/cancel`) — no body required.

- Process Payout (PUT `/api/payouts/:payoutId/process`) — Body (JSON, admin only):

```json
{
  "transactionRef": "BANK_TX_12345",
  "status": "completed" // or "failed"
}
```

- Build Plate (POST `/api/plates/build-plate`) — multipart/form-data (file optional):

```bash
curl -X POST "HOST/api/plates/build-plate" \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/plate.jpg" \
  -F "name=Weekend Special" \
  -F "price=2000" \
  -F "timeToMake=30 mins" \
  -F "items[]=<foodItemId1>" -F "items[]=<foodItemId2>"
```

---

Notes:

- For multipart endpoints use the specified `file` field name when uploading images.
- Replace `HOST` with your API server URL (for local dev: `http://localhost:5000`).
- All authenticated endpoints require the header: `Authorization: Bearer <accessToken>`.

