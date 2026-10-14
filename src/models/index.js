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
  dni: {
    type: DataTypes.STRING(8),
    allowNull: true,
    unique: true,
  },
  address: {
    type: DataTypes.STRING(200),
    allowNull: true,
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

export const RegistrationRequest = sequelize.define("RegistrationRequest", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  status: {
    type: DataTypes.ENUM("pending", "reviewed"),
    allowNull: false,
    defaultValue: "pending",
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

export const BillingSubscription = sequelize.define(
  "BillingSubscription",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    externalReference: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: "external_reference",
    },
    providerSubscriptionId: {
      type: DataTypes.STRING(80),
      allowNull: true,
      unique: true,
      field: "provider_subscription_id",
    },
    initPoint: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "init_point",
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: "creating",
    },
    monthlyAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: "monthly_amount",
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "ARS",
    },
    billingDay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: "billing_day",
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: "start_date",
    },
    nextPaymentDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "next_payment_date",
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "cancelled_at",
    },
  },
  {
    indexes: [{ fields: ["member_id", "status"] }],
  },
);

export const BillingPayment = sequelize.define(
  "BillingPayment",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    providerPaymentId: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
      field: "provider_payment_id",
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "approved_at",
    },
  },
  {
    indexes: [{ fields: ["billing_subscription_id"] }],
  },
);

Member.hasMany(Membership, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
Membership.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Member.hasMany(RegistrationRequest, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
RegistrationRequest.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Plan.hasMany(RegistrationRequest, { foreignKey: { name: "planId", field: "plan_id" }, onDelete: "RESTRICT" });
RegistrationRequest.belongsTo(Plan, { foreignKey: { name: "planId", field: "plan_id" } });
Plan.hasMany(Membership, { foreignKey: { name: "planId", field: "plan_id" }, onDelete: "RESTRICT" });
Membership.belongsTo(Plan, { foreignKey: { name: "planId", field: "plan_id" } });
Member.hasMany(Attendance, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
Attendance.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Member.hasMany(BillingSubscription, {
  foreignKey: { name: "memberId", field: "member_id" },
  onDelete: "RESTRICT",
});
BillingSubscription.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Plan.hasMany(BillingSubscription, {
  foreignKey: { name: "planId", field: "plan_id" },
  onDelete: "RESTRICT",
});
BillingSubscription.belongsTo(Plan, { foreignKey: { name: "planId", field: "plan_id" } });
BillingSubscription.hasMany(BillingPayment, {
  foreignKey: { name: "billingSubscriptionId", field: "billing_subscription_id" },
  onDelete: "RESTRICT",
});
BillingPayment.belongsTo(BillingSubscription, {
  foreignKey: { name: "billingSubscriptionId", field: "billing_subscription_id" },
});
Membership.hasMany(BillingPayment, {
  foreignKey: { name: "membershipId", field: "membership_id" },
  onDelete: "RESTRICT",
});
BillingPayment.belongsTo(Membership, {
  foreignKey: { name: "membershipId", field: "membership_id" },
});

export { sequelize };
