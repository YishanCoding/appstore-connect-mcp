import { z } from 'zod';

const roles = [
    'ADMIN', 'FINANCE', 'TECHNICAL', 'ACCOUNT_HOLDER', 'READ_ONLY', 'SALES',
    'MARKETING', 'APP_MANAGER', 'CUSTOMER_SUPPORT', 'CREATE_APPS', 'DEVELOPER',
    'CLOUD_MANAGED_DEVELOPER_ID', 'CLOUD_MANAGED_APP_DISTRIBUTION', 'GENERATE_INDIVIDUAL_KEYS',
] as const;

export const roleListSchema = z.array(z.string()).superRefine((values, context) => {
    values.forEach((value, index) => {
        if (value === 'ACCESS_TO_REPORTS') {
            context.addIssue({ code: 'custom', path: [index], message:
                'ACCESS_TO_REPORTS 已被 Apple 弃用；按所需报表权限选择 FINANCE（财务报表）或 SALES（销售与分析）。没有一对一替代角色。' });
        } else if (!roles.includes(value as typeof roles[number])) {
            context.addIssue({ code: 'custom', path: [index], message: `未知角色 ${value}；合法值: ${roles.join(', ')}` });
        }
    });
}).describe(`可用角色: ${roles.join(', ')}。ACCESS_TO_REPORTS 已弃用。`);
