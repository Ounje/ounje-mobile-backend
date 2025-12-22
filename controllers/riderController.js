const registerRider = async (req, res) => {
  const { name, selectedZones } = req.body; // e.g., ["Ikeja", "Yaba"]

  // Validation: Check if they picked more than 2
  if (selectedZones.length > 2) {
    return res.status(400).json({ 
        success: false,
        message: "You can only select a maximum of 2 delivery zones." 
    });
  }

  // Save to database (MongoDB/PostgreSQL)
  // await Rider.create({ name, zones: selectedZones });
  
  res.status(201).json({ message: "Rider registered successfully!" + selectedZones.join(", ") });
};