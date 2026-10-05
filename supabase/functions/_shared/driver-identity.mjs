export function normalizeCpf(value) {
  return String(value ?? "").replace(/\D/g, "");
}
export function validCpf(value) {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[size])) return false;
  }
  return true;
}
export function validPin(value) {
  return (
    /^\d{6}$/.test(String(value ?? "")) &&
    !/^(\d)\1{5}$/.test(value) &&
    !["123456", "654321", "012345", "543210"].includes(value)
  );
}
export async function digest(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(result)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function driverEmail(secret, cpf) {
  return `${await digest(secret, "cpf:" + normalizeCpf(cpf))}@motoristas.invalid`;
}
export async function driverPassword(secret, email, pin) {
  return "Dr!9" + (await digest(secret, "pin:" + email + ":" + pin));
}
