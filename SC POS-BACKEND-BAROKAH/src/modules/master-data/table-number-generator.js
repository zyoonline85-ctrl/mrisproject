function alphabeticPrefix(index) {
  let value = Math.max(0, Number(index) || 0) + 1;
  let result = "";

  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }

  return result;
}

function parseTableNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const match = normalized.match(/^(.*?)(\d+)$/);
  if (!match) return null;

  return {
    prefix: match[1].trim(),
    sequence: Number(match[2])
  };
}

function dominantSequence(existingNumbers = []) {
  const groups = new Map();

  existingNumbers.forEach((number) => {
    const parsed = parseTableNumber(number);
    if (!parsed) return;
    const group = groups.get(parsed.prefix) || { prefix: parsed.prefix, count: 0, max: 0 };
    group.count += 1;
    group.max = Math.max(group.max, parsed.sequence);
    groups.set(parsed.prefix, group);
  });

  return [...groups.values()].sort(
    (left, right) => right.count - left.count || right.max - left.max || left.prefix.localeCompare(right.prefix)
  )[0] || null;
}

function generateTableNumbers({ existingNumbers = [], fallbackPrefix = "A", quantity }) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    throw new Error("Jumlah meja wajib bilangan bulat antara 1 sampai 100.");
  }

  const dominant = dominantSequence(existingNumbers);
  const prefix = dominant?.prefix ?? String(fallbackPrefix || "A").trim().toUpperCase();
  let sequence = dominant?.max || 0;
  const usedNumbers = new Set(existingNumbers.map((number) => String(number || "").trim().toUpperCase()));
  const numbers = [];

  while (numbers.length < amount) {
    sequence += 1;
    const candidate = `${prefix}${sequence}`;
    if (!usedNumbers.has(candidate)) {
      numbers.push(candidate);
      usedNumbers.add(candidate);
    }
  }

  return {
    prefix,
    numbers,
    first_number: numbers[0],
    last_number: numbers[numbers.length - 1]
  };
}

module.exports = {
  alphabeticPrefix,
  dominantSequence,
  generateTableNumbers,
  parseTableNumber
};
