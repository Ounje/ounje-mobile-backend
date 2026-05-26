const paginate = async (model, query, populateOptions = [], filter = {}) => {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    // --- NEW SEARCH LOGIC START ---
    if (query.search) {
        // We look for the search term in the 'name' field
        // 'i' makes it case-insensitive (so "Pizza" matches "pizza")
        const searchFilter = {
            $or: [
                { name: { $regex: query.search, $options: "i" } },
                { comboName: { $regex: query.search, $options: "i" } }, // For Combos
                { "storeDetails.name": { $regex: query.search, $options: "i" } } // For Vendors
            ]
        };
        
        // Merge the search filter with any existing filter (like vendor: id)
        filter = { ...filter, ...searchFilter };
    }
    // --- NEW SEARCH LOGIC END ---

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortOrder };

    let mongooseQuery = model.find(filter).sort(sort).skip(skip).limit(limit);

    if (populateOptions) {
        mongooseQuery = mongooseQuery.populate(populateOptions);
    }

    const results = await mongooseQuery;
    const totalDocs = await model.countDocuments(filter);
    const totalPages = Math.ceil(totalDocs / limit);

    return {
        success: true,
        data: results,
        pagination: {
            total: totalDocs,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        }
    };
};

module.exports = { paginate };