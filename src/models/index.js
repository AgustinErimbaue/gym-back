import { DataTypes } from "sequelize";
import { sequelize } from "../config/database.js";

export const Member = sequelize.define("Member", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  firstName: {
    type: DataTypes.STRING(80),
    allowNull: false,
    field: "first_name",
  },
  lastName: {
    type: DataTypes.STRING(80),
    allowNull: false,
    field: "last_name",
  },
  email: {
    type: DataTypes.STRING(254),
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  phone: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("active", "inactive"),
    allowNull: false,
    defaultValue: "active",
  },
});

export const Plan = sequelize.define("Plan", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  durationDays: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: "duration_days",
    validate: { min: 1 },
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 0 },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: "is_active",
  },
});

export const Membership = sequelize.define("Membership", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  startDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: "start_date",
  },
  endDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: "end_date",
  },
  status: {
    type: DataTypes.ENUM("active", "cancelled", "expired"),
    allowNull: false,
    defaultValue: "active",
  },
});

export const Attendance = sequelize.define("Attendance", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  checkedInAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: "checked_in_at",
  },
  checkedOutAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "checked_out_at",
  },
});

Member.hasMany(Membership, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
Membership.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Plan.hasMany(Membership, { foreignKey: { name: "planId", field: "plan_id" }, onDelete: "RESTRICT" });
Membership.belongsTo(Plan, { foreignKey: { name: "planId", field: "plan_id" } });
Member.hasMany(Attendance, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
Attendance.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });

export { sequelize };
