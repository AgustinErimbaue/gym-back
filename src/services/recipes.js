import { body } from "express-validator";

export const recipeTags = ["volumen", "definicion", "rapido", "vegetariano"];

const listItem = (max) => (value) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

export const recipeFields = [
  body("title").isString().trim().notEmpty().isLength({ max: 120 }),
  body("summary").optional({ nullable: true }).isString().trim().isLength({ max: 400 }),
  body("imageUrl")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["https"], require_protocol: true })
    .isLength({ max: 500 }),
  body("tags").optional().isArray({ max: recipeTags.length }),
  body("tags.*").isIn(recipeTags),
  body("prepMinutes").isInt({ min: 1, max: 600 }).toInt(),
  body("servings").optional().isInt({ min: 1, max: 50 }).toInt(),
  body("calories").isInt({ min: 0, max: 5000 }).toInt(),
  body("proteinGrams").isInt({ min: 0, max: 500 }).toInt(),
  body("carbsGrams").isInt({ min: 0, max: 800 }).toInt(),
  body("fatGrams").isInt({ min: 0, max: 500 }).toInt(),
  body("ingredients").isArray({ min: 1, max: 60 }),
  body("ingredients.*").custom(listItem(200)),
  body("steps").isArray({ min: 1, max: 40 }),
  body("steps.*").custom(listItem(600)),
  body("isPublished").optional().isBoolean().toBoolean(),
  body("isFeatured").optional().isBoolean().toBoolean(),
];

export function buildRecipeValues(data) {
  return {
    title: data.title.trim(),
    summary: data.summary?.trim() ?? "",
    imageUrl: data.imageUrl || null,
    tags: [...new Set(data.tags ?? [])],
    prepMinutes: data.prepMinutes,
    servings: data.servings ?? 1,
    calories: data.calories,
    proteinGrams: data.proteinGrams,
    carbsGrams: data.carbsGrams,
    fatGrams: data.fatGrams,
    ingredients: data.ingredients.map((item) => item.trim()),
    steps: data.steps.map((item) => item.trim()),
    ...(data.isPublished === undefined ? {} : { isPublished: data.isPublished }),
    ...(data.isFeatured === undefined ? {} : { isFeatured: data.isFeatured }),
  };
}

export function serializeRecipe(recipe, favoriteIds = new Set()) {
  return {
    id: recipe.id,
    title: recipe.title,
    summary: recipe.summary,
    imageUrl: recipe.imageUrl,
    tags: recipe.tags,
    prepMinutes: recipe.prepMinutes,
    servings: recipe.servings,
    calories: recipe.calories,
    proteinGrams: recipe.proteinGrams,
    carbsGrams: recipe.carbsGrams,
    fatGrams: recipe.fatGrams,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    isFeatured: recipe.isFeatured,
    isFavorite: favoriteIds.has(recipe.id),
  };
}
