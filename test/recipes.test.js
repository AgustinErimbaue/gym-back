import assert from "node:assert/strict";
import test from "node:test";
import { validationResult } from "express-validator";

process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:5432/gym_test";

const { buildRecipeValues, recipeFields, serializeRecipe } = await import("../src/services/recipes.js");

const validRecipe = {
  title: "  Bowl de pollo  ",
  summary: "Rápido y alto en proteína",
  imageUrl: "https://example.com/bowl.jpg",
  tags: ["volumen", "volumen", "rapido"],
  prepMinutes: "20",
  calories: "550",
  proteinGrams: "45",
  carbsGrams: "50",
  fatGrams: "15",
  ingredients: ["200 g de pollo", "1 taza de arroz"],
  steps: ["Cocinar el arroz", "Grillar el pollo"],
};

async function validate(body) {
  const req = { body: structuredClone(body) };
  await Promise.all(recipeFields.map((field) => field.run(req)));
  return { errors: validationResult(req).array(), body: req.body };
}

test("acepta una receta válida y normaliza los valores", async () => {
  const { errors, body } = await validate(validRecipe);
  assert.deepEqual(errors, []);
  const values = buildRecipeValues(body);
  assert.equal(values.title, "Bowl de pollo");
  assert.deepEqual(values.tags, ["volumen", "rapido"]);
  assert.equal(values.prepMinutes, 20);
  assert.equal(values.servings, 1);
});

test("rechaza imágenes no HTTPS, etiquetas desconocidas e ingredientes vacíos", async () => {
  for (const patch of [
    { imageUrl: "http://example.com/a.jpg" },
    { imageUrl: "javascript:alert(1)" },
    { tags: ["milagro"] },
    { ingredients: [] },
    { steps: ["  "] },
    { calories: "-5" },
  ]) {
    const { errors } = await validate({ ...validRecipe, ...patch });
    assert.ok(errors.length > 0, JSON.stringify(patch));
  }
});

test("serializa sin campos internos y marca favoritos", () => {
  const recipe = { ...buildRecipeValues(validRecipe), id: 7, isPublished: false, createdAt: new Date() };
  const result = serializeRecipe(recipe, new Set([7]));
  assert.equal(result.isFavorite, true);
  assert.equal("isPublished" in result, false);
  assert.equal("createdAt" in result, false);
});
