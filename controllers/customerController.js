const Customer = require("../models/Customer");

const getCustomerProfile = async (req, res) => {
    const customerId  = req.params.id;
    try {
        const customer = await Customer.findById(customerId);
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }
        res.json(customer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err });
    }
};

module.exports = { getCustomerProfile }; 