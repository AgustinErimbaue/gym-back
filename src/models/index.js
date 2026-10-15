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
  passwordHash: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: "password_hash",
  },
  profilePhotoData: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: "profile_photo_data",
  },
  profilePhotoUpdatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "profile_photo_updated_at",
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
}, {
  defaultScope: {
    attributes: { exclude: ["passwordHash", "profilePhotoData"] },
  },
});

export const MemberPushToken = sequelize.define(
  "MemberPushToken",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    memberId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "member_id",
    },
    token: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    platform: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [["ios", "android"]] },
    },
  },
  {
    indexes: [{ fields: ["member_id"] }],
  },
);

export const Recipe = sequelize.define("Recipe", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(120), allowNull: false },
  summary: { type: DataTypes.STRING(400), allowNull: false, defaultValue: "" },
  imageUrl: { type: DataTypes.STRING(500), allowNull: true, field: "image_url" },
  tags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  prepMinutes: { type: DataTypes.INTEGER, allowNull: false, field: "prep_minutes" },
  servings: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  calories: { type: DataTypes.INTEGER, allowNull: false },
  proteinGrams: { type: DataTypes.INTEGER, allowNull: false, field: "protein_grams" },
  carbsGrams: { type: DataTypes.INTEGER, allowNull: false, field: "carbs_grams" },
  fatGrams: { type: DataTypes.INTEGER, allowNull: false, field: "fat_grams" },
  ingredients: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  steps: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_published" },
  isFeatured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_featured" },
});

export const RecipeFavorite = sequelize.define(
  "RecipeFavorite",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    memberId: { type: DataTypes.INTEGER, allowNull: false, field: "member_id" },
    recipeId: { type: DataTypes.INTEGER, allowNull: false, field: "recipe_id" },
  },
  { indexes: [{ unique: true, fields: ["member_id", "recipe_id"] }] },
);

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

export const PendingMemberRegistration = sequelize.define("PendingMemberRegistration", {
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
    allowNull: false,
  },
  address: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  planId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: "plan_id",
    references: { model: Plan, key: "id" },
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
  },
  tokenHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    field: "token_hash",
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: "expires_at",
  },
}, {
  indexes: [
    { fields: ["expires_at"] },
  ],
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

export const AccessPass = sequelize.define("AccessPass", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  tokenHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    field: "token_hash",
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: "expires_at",
  },
  usedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "used_at",
  },
});

export const Workout = sequelize.define(
  "Workout",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    method: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [["heavyDuty", "weider"]] },
    },
    level: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [["Principiante", "Intermedio", "Experto"]] },
    },
    routineName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      field: "routine_name",
    },
    exercises: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    feedback: {
      type: DataTypes.STRING(1000),
      allowNull: false,
    },
    performedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "performed_at",
    },
  },
  {
    indexes: [{ fields: ["member_id", "performed_at"] }],
  },
);

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

export const CommunityProfile = sequelize.define("CommunityProfile", {
  memberId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    field: "member_id",
  },
  isVisible: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "is_visible",
  },
  trainingLevel: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: "training_level",
    validate: { isIn: [["Principiante", "Intermedio", "Experto"]] },
  },
  goal: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
});

export const CommunityConnection = sequelize.define(
  "CommunityConnection",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    memberA: { type: DataTypes.INTEGER, allowNull: false, field: "member_a" },
    memberB: { type: DataTypes.INTEGER, allowNull: false, field: "member_b" },
    requestedBy: { type: DataTypes.INTEGER, allowNull: false, field: "requested_by" },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "pending",
      validate: { isIn: [["pending", "accepted"]] },
    },
  },
  {
    indexes: [
      { unique: true, fields: ["member_a", "member_b"] },
      { fields: ["member_a", "status"] },
      { fields: ["member_b", "status"] },
    ],
  },
);

export const CommunityBlock = sequelize.define(
  "CommunityBlock",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    blockedBy: { type: DataTypes.INTEGER, allowNull: false, field: "blocked_by" },
    blockedMemberId: { type: DataTypes.INTEGER, allowNull: false, field: "blocked_member_id" },
  },
  {
    indexes: [{ unique: true, fields: ["blocked_by", "blocked_member_id"] }],
  },
);

export const CommunityReport = sequelize.define(
  "CommunityReport",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    reporterId: { type: DataTypes.INTEGER, allowNull: false, field: "reporter_id" },
    reportedMemberId: { type: DataTypes.INTEGER, allowNull: false, field: "reported_member_id" },
    reason: {
      type: DataTypes.STRING(32),
      allowNull: false,
      validate: { isIn: [["inappropriate", "harassment", "fake_profile", "other"]] },
    },
    details: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "open",
      validate: { isIn: [["open", "reviewed", "resolved"]] },
    },
  },
  {
    indexes: [{ fields: ["status", "created_at"] }],
  },
);

export const CommunityMessage = sequelize.define(
  "CommunityMessage",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    senderId: { type: DataTypes.INTEGER, allowNull: false, field: "sender_id" },
    recipientId: { type: DataTypes.INTEGER, allowNull: false, field: "recipient_id" },
    body: { type: DataTypes.STRING(2000), allowNull: false },
  },
  {
    indexes: [
      { fields: ["sender_id", "recipient_id", "id"] },
      { fields: ["recipient_id", "sender_id", "id"] },
    ],
  },
);

export const PasswordResetCode = sequelize.define(
  "PasswordResetCode",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    memberId: { type: DataTypes.INTEGER, allowNull: false, field: "member_id" },
    codeHash: { type: DataTypes.STRING(64), allowNull: false, field: "code_hash" },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { indexes: [{ fields: ["member_id"] }] },
);

export const BodyMeasurement = sequelize.define(
  "BodyMeasurement",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    memberId: { type: DataTypes.INTEGER, allowNull: false, field: "member_id" },
    measuredOn: { type: DataTypes.DATEONLY, allowNull: false, field: "measured_on" },
    weightKg: { type: DataTypes.DECIMAL(5, 2), allowNull: false, field: "weight_kg" },
    bodyFatPercent: { type: DataTypes.DECIMAL(4, 1), allowNull: true, field: "body_fat_percent" },
    waistCm: { type: DataTypes.DECIMAL(5, 1), allowNull: true, field: "waist_cm" },
    chestCm: { type: DataTypes.DECIMAL(5, 1), allowNull: true, field: "chest_cm" },
    hipsCm: { type: DataTypes.DECIMAL(5, 1), allowNull: true, field: "hips_cm" },
    armCm: { type: DataTypes.DECIMAL(4, 1), allowNull: true, field: "arm_cm" },
  },
  { indexes: [{ unique: true, fields: ["member_id", "measured_on"] }] },
);

export const GymClass = sequelize.define(
  "GymClass",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.STRING(400), allowNull: false, defaultValue: "" },
    instructor: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    startsAt: { type: DataTypes.DATE, allowNull: false, field: "starts_at" },
    durationMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60, field: "duration_minutes" },
    capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15 },
    isCancelled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_cancelled" },
  },
  { indexes: [{ fields: ["starts_at"] }] },
);

export const ClassBooking = sequelize.define(
  "ClassBooking",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, allowNull: false, field: "class_id" },
    memberId: { type: DataTypes.INTEGER, allowNull: false, field: "member_id" },
  },
  {
    indexes: [
      { unique: true, fields: ["class_id", "member_id"] },
      { fields: ["member_id"] },
    ],
  },
);

export const NotificationLog = sequelize.define(
  "NotificationLog",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    memberId: { type: DataTypes.INTEGER, allowNull: false, field: "member_id" },
    kind: { type: DataTypes.STRING(40), allowNull: false },
    refKey: { type: DataTypes.STRING(80), allowNull: false, field: "ref_key" },
  },
  { indexes: [{ unique: true, fields: ["member_id", "kind", "ref_key"] }] },
);

PasswordResetCode.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
BodyMeasurement.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
ClassBooking.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
ClassBooking.belongsTo(GymClass, { foreignKey: { name: "classId", field: "class_id" }, onDelete: "CASCADE" });
GymClass.hasMany(ClassBooking, { foreignKey: { name: "classId", field: "class_id" }, onDelete: "CASCADE" });
NotificationLog.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });

CommunityProfile.belongsTo(Member, {
  foreignKey: { name: "memberId", field: "member_id" },
  onDelete: "RESTRICT",
});
Member.hasOne(CommunityProfile, {
  foreignKey: { name: "memberId", field: "member_id" },
  onDelete: "RESTRICT",
});
CommunityConnection.belongsTo(Member, {
  as: "memberAProfile",
  foreignKey: { name: "memberA", field: "member_a" },
  onDelete: "RESTRICT",
});
CommunityConnection.belongsTo(Member, {
  as: "memberBProfile",
  foreignKey: { name: "memberB", field: "member_b" },
  onDelete: "RESTRICT",
});
CommunityBlock.belongsTo(Member, {
  as: "blocker",
  foreignKey: { name: "blockedBy", field: "blocked_by" },
  onDelete: "RESTRICT",
});
CommunityBlock.belongsTo(Member, {
  as: "blockedMember",
  foreignKey: { name: "blockedMemberId", field: "blocked_member_id" },
  onDelete: "RESTRICT",
});
CommunityReport.belongsTo(Member, {
  as: "reporter",
  foreignKey: { name: "reporterId", field: "reporter_id" },
  onDelete: "RESTRICT",
});
CommunityReport.belongsTo(Member, {
  as: "reportedMember",
  foreignKey: { name: "reportedMemberId", field: "reported_member_id" },
  onDelete: "RESTRICT",
});
CommunityMessage.belongsTo(Member, {
  as: "sender",
  foreignKey: { name: "senderId", field: "sender_id" },
  onDelete: "RESTRICT",
});
CommunityMessage.belongsTo(Member, {
  as: "recipient",
  foreignKey: { name: "recipientId", field: "recipient_id" },
  onDelete: "RESTRICT",
});

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
Member.hasMany(AccessPass, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
AccessPass.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
Member.hasMany(MemberPushToken, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
MemberPushToken.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
Member.hasMany(RecipeFavorite, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
RecipeFavorite.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "CASCADE" });
Recipe.hasMany(RecipeFavorite, { foreignKey: { name: "recipeId", field: "recipe_id" }, onDelete: "CASCADE" });
RecipeFavorite.belongsTo(Recipe, { foreignKey: { name: "recipeId", field: "recipe_id" }, onDelete: "CASCADE" });
Member.hasMany(Workout, { foreignKey: { name: "memberId", field: "member_id" }, onDelete: "RESTRICT" });
Workout.belongsTo(Member, { foreignKey: { name: "memberId", field: "member_id" } });
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
