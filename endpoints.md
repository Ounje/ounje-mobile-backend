# Vendor API Endpoints

Base path (example):

/api/vendors

All responses are returned in JSON format unless otherwise stated.

---

## Get Popular Vendors

Retrieve vendors ordered by popularity (based on total orders).

Endpoint  
GET /popular

Authentication  
Not required

Request Parameters  
None

Success Response  
200 OK

[
{
"_id": "vendor_id",
"storeName": "Vendor Store",
"totalOrders": 120,
"rating": 4.5
}
]

Error Responses  
500 Internal Server Error

---

## Get Authenticated Vendor Profile (Vendor Dashboard)

Retrieve the authenticated vendor’s full profile, including their menu.

Endpoint  
GET /profile

Authentication  
Required (Bearer token)

Authorization  
Vendor only

Request Parameters  
None

Success Response  
200 OK

{
"\_id": "vendor_id",
"storeName": "Vendor Store",
"email": "vendor@example.com",
"menu": [
{
"_id": "menu_id",
"name": "Menu Item"
}
],
"balance": 5000
}

Error Responses  
401 Unauthorized  
404 Not Found – Vendor not found  
500 Internal Server Error

---

## Update Vendor Bank Details

Update vendor bank details and retry any pending payouts.

Endpoint  
PUT /profile/bank-details

Authentication  
Required (Bearer token)

Authorization  
Vendor only

Request Body

{
"accountNumber": "1234567890",
"bankCode": "058",
"accountName": "Vendor Name"
}

Success Response  
200 OK

{
"vendor": {
"\_id": "vendor_id",
"bankDetails": {
"accountNumber": "1234567890",
"bankCode": "058",
"accountName": "Vendor Name"
}
},
"retryResults": {
"processed": 2,
"failed": 0
}
}

Error Responses  
400 Bad Request – Missing required fields  
401 Unauthorized  
500 Internal Server Error

---

## Get Vendor by ID (Customer View)

Retrieve a vendor’s public profile, menu, and food items.

Endpoint  
GET /vendor/:id

Authentication  
Not required

Path Parameters

id (string) – Vendor MongoDB ObjectId

Success Response  
200 OK

{
"\_id": "vendor_id",
"storeName": "Vendor Store",
"menu": [
{
"_id": "menu_id",
"name": "Menu Item"
}
],
"foodItems": [
{
"_id": "food_id",
"name": "Food Item",
"price": 2500
}
]
}

Error Responses  
400 Bad Request – Invalid Vendor ID format  
404 Not Found – Vendor not found  
500 Internal Server Error

---

## Get Nearby Vendors

Retrieve vendors near the authenticated user using GPS or saved profile location.
Falls back to a default vendor list if no location is available.

Endpoint  
GET /nearby

Authentication  
Required (Bearer token)

Query Parameters (optional)

lat (number) – Latitude  
lng (number) – Longitude

Success Response (Location-Based)  
200 OK

{
"status": "success",
"source": "location-based",
"results": 5,
"data": [
{
"_id": "vendor_id",
"storeName": "Nearby Vendor",
"isAvailable": true
}
]
}

Success Response (Fallback)  
200 OK

{
"status": "success",
"source": "default-fallback",
"results": 20,
"data": [
{
"_id": "vendor_id",
"storeName": "Vendor Store"
}
]
}

Error Responses  
401 Unauthorized  
500 Internal Server Error

---

## Complete Vendor Registration

Complete vendor onboarding by submitting store details and NIN documentation.

Endpoint  
POST /complete-registration

Authentication  
Required (Bearer token)

Authorization  
Vendor only

Content Type  
multipart/form-data

Form Data

storeName (string, required)  
storeType (string, required) – physicalStore | onlineStore  
servicesOffered (string, required) – InstantMeals | preOrderMeals | hybridMeals  
isVerifiedBusiness (boolean, optional)  
CACNumber (string, required if verified business)  
needCACHelp (string, optional) – yes | no  
ninID (file, required) – NIN identification document

Success Response (Completed Registration)  
200 OK

{
"success": true,
"message": "Vendor registration completed successfully",
"data": {
"storeName": "Vendor Store",
"storeType": "physicalStore",
"servicesOffered": "InstantMeals",
"status": "active"
}
}

Success Response (CAC Support Required)  
200 OK

{
"success": true,
"message": "Store details saved successfully. Our support team will contact you shortly regarding CAC registration assistance.",
"requiresSupport": true,
"data": {
"vendorId": "vendor_id",
"storeName": "Vendor Store",
"status": "pending"
}
}

Error Responses  
400 Bad Request – Validation or business rule failure  
401 Unauthorized  
404 Not Found – Vendor not found  
500 Internal Server Error

---

## Notes

- All authenticated endpoints require the header:

Authorization: Bearer <token>

- File uploads are handled via Cloudinary.
- MongoDB ObjectId validation is enforced where applicable.
- Response fields may include additional vendor metadata depending on schema evolution.
