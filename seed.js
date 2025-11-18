const mongoose = require('mongoose');

// --- 1. CONFIGURATION AND CONNECTION ---
// IMPORTANT: Replace this with your actual MongoDB connection string
const mongoURI = 'mongodb+srv://charles:T-chimow123@cluster0.9n0yftk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(mongoURI)
.then(() => console.log('✅ MongoDB connected successfully for seeding.'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// --- 2. MODEL DEFINITIONS (Based on your provided schemas) ---

// Base User Schema (For Discriminators)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    location: String,
    phone: Number,
    img: String,
}, { 
    timestamps: true,
    discriminatorKey: "role", 
    collection: "users" 
});

const User = mongoose.model("User", userSchema);

// Customer (User Discriminator)
const Customer = User.discriminator("customer", new mongoose.Schema({
    wallet: {type: String, default: "null"}
}));

// Vendor (User Discriminator)
const VendorSchema = new mongoose.Schema({
    img: String,
    description: String,
    totalRating: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    minPrice: Number,
    closeTime: String,
    isAvailable: { type: Boolean, default: true },
    minDeliveryFee: Number,
    closingTime: String,
});
const Vendor = User.discriminator("vendor", VendorSchema);

// Dish Model
const dishSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: [String],
    category: String,
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "vendor" , required: true },
    price: { type: Number, required: true },
    img: String,
    ordersCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    rating: { type: Number, default: 0 },
    time: {type: String, required: true},
    likes: { type: Number, default: 0},
    deliveryTime: String,
    minPrice: { type: Number, required: true },
}, { timestamps: true });
const Dish = mongoose.model("Dish", dishSchema);

// FoodItem Model
const foodItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    img: { type: String, required: true },
    description: { type: String },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    category: {type: String, required: true},
    sellingUnit: { type: String, required: true },
});
const FoodItem = mongoose.model("FoodItem", foodItemSchema);

// Plate Model
const plateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "customer" , required: true },
    price: { type: Number, required: true },
    img: String,
    options: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodIem' }],
    // ... (omitted other fields for brevity in this definition)
}, { timestamps: true });
const Plate = mongoose.model("Plate", plateSchema);

// Order Model
const orderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    items: [
        {
            itemType: { type: String, enum: ["FoodItem", "Dish", "Plate"], required: true },
            itemId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "items.itemType" },
            quantity: { type: Number, default: 1, min: 1 },
            price: { type: Number, required: true },
            notes: String,
        }
    ],
    totalPrice: { type: Number, required: true },
    status: { type: String, enum: ["pending", "accepted", "in_progress", "completed", "cancelled"], default: "pending" },
    deliveryAddress: { type: String },
    // ... (omitted other fields for brevity in this definition)
});
const Order = mongoose.model("Order", orderSchema);


// --- 3. SEEDING FUNCTION ---
const seedDB = async () => {
    try {
        // A. Clear existing data
        console.log('🗑️ Clearing existing data...');
        await Promise.all([
            User.deleteMany({}),
            Dish.deleteMany({}),
            FoodItem.deleteMany({}),
            Plate.deleteMany({}),
            Order.deleteMany({}),
            // Add other models like FoodCategory, Rating, Payment if needed
        ]);
        console.log('   All collections cleared.');

        // B. Create Core Users (Vendor and Customer)
        const sampleVendor = await Vendor.create({
            name: 'The Golden Wok',
            email: 'vendor1@example.com',
            phone: 1234567890,
            location: '101 Market Street',
            minPrice: 15,
            minDeliveryFee: 5,
            closingTime: '22:00',
            description: 'The best Asian cuisine in town.',
            isAvailable: true,
        });

        const sampleCustomer = await Customer.create({
            name: 'Alice Johnson',
            email: 'alice@example.com',
            phone: 9876543210,
            location: '456 Elm Road, Apt 1A',
        });
        
        console.log(`👤 Created Vendor (ID: ${sampleVendor._id}) and Customer (ID: ${sampleCustomer._id}).`);

        // C. Create Products (Dish, FoodItem, Plate)
        const sampleDish = await Dish.create({
            name: 'Spicy Noodles',
            description: ['Wheat noodles', 'Chicken', 'Vegetables'],
            category: 'Main Course',
            vendor: sampleVendor._id,
            price: 18.50,
            time: '30 mins',
            minPrice: 10,
        });

        const sampleFoodItem = await FoodItem.create({
            name: 'Soda Can',
            price: 2.00,
            img: 'url/to/soda.jpg',
            vendor: sampleVendor._id,
            category: 'Beverage',
            sellingUnit: 'Can',
        });

        const samplePlate = await Plate.create({
            name: 'Alice\'s Custom Platter',
            customer: sampleCustomer._id,
            price: 25.00,
            timeToMake: '45 mins',
        });
        
        console.log('🍽️ Created sample Dish, FoodItem, and Plate.');

        // D. Create a Sample Order
        const orderTotalPrice = (sampleDish.price * 2) + (sampleFoodItem.price * 1) + (samplePlate.price * 1);
        
        const sampleOrder = await Order.create({
            user: sampleCustomer._id,
            vendor: sampleVendor._id,
            deliveryAddress: sampleCustomer.location,
            totalPrice: orderTotalPrice,
            items: [
                {
                    itemType: 'Dish',
                    itemId: sampleDish._id,
                    quantity: 2,
                    price: sampleDish.price, // Price is recorded at time of order
                    notes: 'Extra chili sauce on the noodles.',
                },
                {
                    itemType: 'FoodItem',
                    itemId: sampleFoodItem._id,
                    quantity: 1,
                    price: sampleFoodItem.price,
                },
                {
                    itemType: 'Plate',
                    itemId: samplePlate._id,
                    quantity: 1,
                    price: samplePlate.price,
                    notes: 'Handle with care.',
                }
            ],
        });

        console.log(`📝 Order created successfully! (ID: ${sampleOrder._id})`);
        
        // --- DATA FOR TESTING YOUR ENDPOINT ---
        console.log('\n======================================================');
        console.log('  DATA READY FOR TESTING createOrder ENDPOINT');
        console.log('======================================================');
        console.log(`Test Customer ID (req.user._id): ${sampleCustomer._id}`);
        console.log(`Test Vendor ID (vendorId):      ${sampleVendor._id}`);
        console.log('\nSample Request Body to Test createOrder:');
        
        const testPayload = {
            vendorId: sampleVendor._id.toString(),
            deliveryAddress: sampleCustomer.location,
            items: [
                {
                    itemId: sampleDish._id.toString(),
                    itemType: 'Dish',
                    quantity: 1,
                    notes: 'No peanuts.'
                },
                {
                    itemId: sampleFoodItem._id.toString(),
                    itemType: 'FoodItem',
                    quantity: 3
                },
                {
                    itemId: samplePlate._id.toString(),
                    itemType: 'Plate',
                    quantity: 1
                }
            ]
        };
        console.log(JSON.stringify(testPayload, null, 2));


    } catch (error) {
        console.error('❌ Error during seeding:', error);
    } finally {
        // E. Close connection
        mongoose.connection.close();
        console.log('\nGoodbye! Mongoose connection closed.');
    }
};

seedDB();