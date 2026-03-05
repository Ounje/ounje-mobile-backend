const https = require('https');

const keepAlive = (url, intervalInMins = 14) => {
    console.log(`[Keep-Alive] Initialized for ${url}. Pinging every ${intervalInMins} minutes...`);

    // Set up the interval for periodic pinging
    setInterval(() => {
        https.get(url, (res) => {
            // Consume response data to free up memory
            res.on('data', () => { });
            res.on('end', () => {
                console.log(`[Keep-Alive] Pinged ${url} - Status: ${res.statusCode}`);
            });
        }).on('error', (err) => {
            console.error(`[Keep-Alive] Error pinging ${url}:`, err.message);
        });
    }, intervalInMins * 60 * 1000);
};

module.exports = keepAlive;
