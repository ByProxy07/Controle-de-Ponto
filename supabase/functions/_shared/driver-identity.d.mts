export function normalizeCpf(value:unknown):string;
export function validCpf(value:unknown):boolean;
export function validPin(value:unknown):boolean;
export function digest(secret:string,value:string):Promise<string>;
export function driverEmail(secret:string,cpf:string):Promise<string>;
export function driverPassword(secret:string,email:string,pin:string):Promise<string>;
