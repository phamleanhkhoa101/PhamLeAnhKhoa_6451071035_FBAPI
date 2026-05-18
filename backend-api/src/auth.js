import dotenv from "dotenv";

dotenv.config();

export function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Admin permission required"
    });
  }

  next();
}