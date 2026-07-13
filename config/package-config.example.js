'use strict';
// 报销包全局身份/账户配置（模板）
// 用法：复制本文件为 package-config.js，填入真实值。真实文件已被 .gitignore 忽略，不进版本库。
// 优先级：环境变量 > package-config.js > 本模板的占位值。
module.exports = {
  claimer: '{{报销人}}',             // 报销人（报销单申请人）
  department: '{{部门}}',            // 部门
  buyerName: '{{购买方抬头}}',       // 报销单抬头 / 付款方单位
  buyerTax: '{{购买方税号}}',        // 税号
  approver: '{{审批人}}',            // 审批人（一级审批）
  cashier: '{{出纳}}',               // 出纳
  payerBank: '{{付款方账户/开户行}}', // 付款方账户/开户行
  payeeBank: '{{收款人账户/开户行}}', // 收款人账户/开户行
  // —— 以下为模板化扩展字段（报销单层面，非发票层面）——
  costCenter: '{{成本中心}}',         // 成本中心（预算归属）
  budgetCategory: '{{预算科目}}',     // 预算科目
  contractNo: '{{合同号}}',           // 关联合同号
  approvers: ['{{审批人}}'],          // 多级审批人数组（按顺序）
  reviewer: '{{复核人}}',
  // 注：要用「模板化报销单」自动跑批，设环境变量 REIMBURSEMENT_TEMPLATE="user/name[:version]"
  // （不需要在此文件声明；未设置则该功能完全不介入，行为不变）。             // 复核人
};
