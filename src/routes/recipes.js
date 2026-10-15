import { Router } from "express";
import { param, query } from "express-validator";
import { Member, Recipe, RecipeFavorite } from "../models/index.js";
import { requireMemberSession } from "../middleware/requireMemberSession.js";
import { validateRequest } from "../middleware/validate.js";
import { recipeTags, serializeRecipe } from "../services/recipes.js";

const router = Router();

router.use(requireMemberSession);
router.use(async (req, res, next) => {
  try {
    const member = await Member.findByPk(req.member.id, { attributes: ["id", "status"] });
    if (!member || member.status !== "active") {
      return res.status(403).json({ error: "Las recetas están disponibles para socios activos." });
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

async function loadFavoriteIds(memberId) {
  const favorites = await RecipeFavorite.findAll({ where: { memberId }, attributes: ["recipeId"] });
  return new Set(favorites.map(({ recipeId }) => recipeId));
}

router.get(
  "/",
  [query("tag").optional().isIn(recipeTags), query("favorites").optional().isBoolean()],
  validateRequest,
  async (req, res, next) => {
    try {
      const [recipes, favoriteIds] = await Promise.all([
        Recipe.findAll({
          where: { isPublished: true },
          order: [["isFeatured", "DESC"], ["createdAt", "DESC"], ["id", "DESC"]],
          limit: 200,
        }),
        loadFavoriteIds(req.member.id),
      ]);
      const filtered = recipes.filter(
        (recipe) =>
          (!req.query.tag || recipe.tags.includes(req.query.tag)) &&
          (req.query.favorites !== "true" || favoriteIds.has(recipe.id)),
      );
      return res.json(filtered.map((recipe) => serializeRecipe(recipe, favoriteIds)));
    } catch (error) {
      return next(error);
    }
  },
);

router.put("/:id/favorite", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    const recipe = await Recipe.findOne({ where: { id: req.params.id, isPublished: true }, attributes: ["id"] });
    if (!recipe) return res.status(404).json({ error: "No se encontró la receta." });
    await RecipeFavorite.findOrCreate({ where: { memberId: req.member.id, recipeId: recipe.id } });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/favorite", param("id").isInt({ min: 1 }), validateRequest, async (req, res, next) => {
  try {
    await RecipeFavorite.destroy({ where: { memberId: req.member.id, recipeId: req.params.id } });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
