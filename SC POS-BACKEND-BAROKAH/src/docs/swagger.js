const swaggerJsdoc = require("swagger-jsdoc");

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "POS Barokah Backend API",
      version: "0.1.0",
      description: "Express CommonJS + MySQL + Knex API untuk Admin Web dan APK Kasir Barokah."
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Local development"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Validasi data gagal." }
          }
        }
      }
    }
  },
  apis: ["./src/**/*.js"]
});

module.exports = swaggerSpec;
