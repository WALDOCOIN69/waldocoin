// utils/db.js
const db = {
    proposals: {
      // Example pre-filled proposal (remove or replace later)
      "example-proposal": {
        title: "Should WALDO burn 1 million tokens?",
        description: "Community vote on deflation strategy",
        options: ["Yes", "No"],
        start: new Date().toISOString(),
        end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
        votes: {} // wallet => choice
      }
    }
  };
  
  export default db;
  