// Small, reviewed seed from USDA FoodData Central SR Legacy (April 2018).
// Values are per 100 g. Keep each preparation state visible; do not conflate raw and cooked foods.
const foods = [
  { fdcId: 169757, name: '熟白米饭', aliases: ['米饭', '白米饭', 'rice'], description: 'Rice, white, long-grain, regular, unenriched, cooked without salt', nutrition: { calories: 130, protein: 2.69, carbs: 28.17, fat: 0.28 } },
  { fdcId: 173424, name: '水煮鸡蛋', aliases: ['鸡蛋', '水煮蛋', 'egg'], description: 'Egg, whole, cooked, hard-boiled', nutrition: { calories: 155, protein: 12.58, carbs: 1.12, fat: 10.61 } },
  { fdcId: 171477, name: '烤熟鸡胸肉', aliases: ['鸡胸肉', '鸡肉', 'chicken breast'], description: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', nutrition: { calories: 165, protein: 31.02, carbs: 0, fat: 3.57 } },
  { fdcId: 173944, name: '生香蕉', aliases: ['香蕉', 'banana'], description: 'Bananas, raw', nutrition: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 } },
  { fdcId: 171688, name: '带皮生苹果', aliases: ['苹果', 'apple'], description: "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)", nutrition: { calories: 52, protein: 0.26, carbs: 13.81, fat: 0.17 } },
  { fdcId: 170440, name: '去皮水煮土豆', aliases: ['土豆', '马铃薯', 'potato'], description: 'Potatoes, boiled, cooked without skin, flesh, without salt', nutrition: { calories: 86, protein: 1.71, carbs: 20.01, fat: 0.1 } },
  { fdcId: 171265, name: '全脂牛奶', aliases: ['牛奶', 'milk'], description: 'Milk, whole, 3.25% milkfat, with added vitamin D', nutrition: { calories: 61, protein: 3.15, carbs: 4.8, fat: 3.25 } },
  { fdcId: 170379, name: '生西兰花', aliases: ['西兰花', '花椰菜', 'broccoli'], description: 'Broccoli, raw', nutrition: { calories: 34, protein: 2.82, carbs: 6.64, fat: 0.37 } },
  { fdcId: 172475, name: '生硬豆腐（硫酸钙）', aliases: ['豆腐', '硬豆腐', 'tofu'], description: 'Tofu, raw, firm, prepared with calcium sulfate', nutrition: { calories: 144, protein: 17.27, carbs: 2.78, fat: 8.72 } },
  { fdcId: 169705, name: '干燕麦', aliases: ['燕麦', '干燕麦片', 'oats'], description: "Oats (Includes foods for USDA's Food Distribution Program)", nutrition: { calories: 389, protein: 16.89, carbs: 66.27, fat: 6.9 } }
];
function searchFoods(query = '', limit = 8) {
  const raw = String(query).trim();
  if (raw.length > 40) throw new Error('搜索词过长');
  const q = raw.toLocaleLowerCase();
  return foods.filter(food => !q || [food.name, food.description, ...food.aliases].some(value => value.toLocaleLowerCase().includes(q)))
    .slice(0, q ? limit : 4).map(food => ({ ...food, aliases: undefined, source: 'USDA FoodData Central · SR Legacy 2018',
      sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`, basisAmount: 100, basisUnit: 'g' }));
}
module.exports = { searchFoods };
