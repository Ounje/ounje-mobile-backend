function calculateDeliveryFee(distanceKm) {
  const base = 500;         
  const perKm = 120;         
  return Math.round(base + distanceKm * perKm);
}
//these are dummy rates. Not added our rates yet

module.exports = { calculateDeliveryFee };
