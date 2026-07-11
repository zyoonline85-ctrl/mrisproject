const app = require("./app");
const env = require("./config/env");

app.listen(env.port, () => {
  console.log(`POS Backend Barokah jalan di http://localhost:${env.port}`);
  console.log(`Swagger UI: http://localhost:${env.port}/api/docs`);
  console.log(`Data mode: ${env.dataMode}`);
  console.log(`CORS origins: ${env.corsOrigins.join(", ")}`);
});
