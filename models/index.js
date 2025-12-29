// Central model loader — require this early (e.g., in server.js) to ensure all models are registered with Mongoose
require('./User');
require('./Vendor');
require('./Rider');
require('./Customer');
require('./Order');
require('./Payment');
require('./Payout');
require('./LedgerAccount');
require('./LedgerEntry');
require('./Plate');
require('./Dish');
require('./FoodItem');
require('./VendorRating');
require('./SupportTicket');

module.exports = true;