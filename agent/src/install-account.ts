export const validAdminUsername=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{2,59}$/.test(value);
export const validAdminPassword=(value:unknown):value is string=>typeof value==='string'&&value.length>=12&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value);
