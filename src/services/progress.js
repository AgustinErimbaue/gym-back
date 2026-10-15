const maxExercises = 8;
const maxPoints = 12;

// Resume, por ejercicio, la mejor marca y la evolución del peso máximo por entrenamiento.
export function buildExerciseProgress(workouts) {
  const byExercise = new Map();
  const ordered = [...workouts].sort(
    (a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime(),
  );

  for (const workout of ordered) {
    const bestInWorkout = new Map();
    for (const exercise of workout.exercises ?? []) {
      const name = String(exercise?.name ?? "").trim();
      const weightKg = Number(exercise?.weightKg);
      const reps = Number(exercise?.reps);
      if (!name || !Number.isFinite(weightKg) || !Number.isFinite(reps)) continue;
      const key = name.toLowerCase();
      const current = bestInWorkout.get(key);
      if (!current || weightKg > current.weightKg) {
        bestInWorkout.set(key, { name, weightKg, reps });
      }
    }

    for (const [key, entry] of bestInWorkout) {
      const stats = byExercise.get(key) ?? { name: entry.name, points: [] };
      stats.points.push({ date: new Date(workout.performedAt).toISOString(), ...entry });
      byExercise.set(key, stats);
    }
  }

  return [...byExercise.values()]
    .map(({ name, points }) => {
      const best = points.reduce((top, point) => (point.weightKg >= top.weightKg ? point : top));
      const first = points[0];
      const last = points.at(-1);
      return {
        name,
        sessions: points.length,
        bestWeightKg: best.weightKg,
        bestReps: best.reps,
        bestOn: best.date,
        lastWeightKg: last.weightKg,
        changeKg: Math.round((last.weightKg - first.weightKg) * 100) / 100,
        points: points.slice(-maxPoints).map(({ date, weightKg }) => ({ date, weightKg })),
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
    .slice(0, maxExercises);
}
