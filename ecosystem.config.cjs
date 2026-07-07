module.exports = {
  apps: [
    {
      name: "wapi-gateway",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
    }
  ]
};
