const jwt = require("jsonwebtoken");
const getPrismaClient = require("../lib/prisma");

const prisma = getPrismaClient();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        profilePicture: true,
        role: true,
        permissions: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ message: "Invalid token - user not found or inactive" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.error("Auth middleware error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

module.exports = { authenticateToken };
