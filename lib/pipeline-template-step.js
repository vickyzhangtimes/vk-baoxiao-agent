'use strict';
/**
 * lib/pipeline-template-step.js — 把模板渲染接进 run-all 的步骤构造器（P3 接入）
 *
 * 纯函数：根据环境开关 REIMBURSEMENT_TEMPLATE（格式 "user/name[:version]"）构造一个
 * run-all 步骤对象；未设置或格式非法时返回 null（不接入，零行为变化）。
 *
 * 这样 run-all 只需 require 本模块并 push 进 commonTail，无需在编排器顶层写分支逻辑，
 * 也便于单测（不触发真实流水线）。
 */

const path = require('path');

function templateOutPath(ctx, user, name) {
  return path.join(ctx.scanDir, `报销单-${user}-${name}-${ctx.dateTag}.xlsx`);
}

function buildTemplateRenderStep(ctx) {
  const cfg = process.env.REIMBURSEMENT_TEMPLATE;
  if (!cfg || !cfg.includes('/')) return null;
  const [user, rest] = cfg.split('/');
  const [name, verStr] = (rest || '').split(':');
  if (!user || !name) return null;

  const outFile = templateOutPath(ctx, user, name);
  const args = [
    '--user', user, '--name', name,
    '--dateTag', ctx.dateTag,
    '--input', ctx.invoiceFinalFile,
    '--output', outFile,
  ];
  if (verStr) args.push('--version', verStr);

  const tplDir = path.join(ctx.root, 'templates', user, name);
  return {
    key: 'template-render',
    label: 'Step 8b/12 template reimbursement form',
    script: 'render-reimbursement.js',
    args,
    // 脏检查依赖：数据源 + 模板渲染全部代码 + 模板目录本身
    inputs: [
      ctx.invoiceFinalFile,
      path.join(ctx.root, 'render-reimbursement.js'),
      path.join(ctx.root, 'lib', 'template-store.js'),
      path.join(ctx.root, 'lib', 'render-template.js'),
      path.join(ctx.root, 'lib', 'rollup.js'),
      path.join(ctx.root, 'lib', 'build-contract.js'),
      path.join(ctx.root, 'lib', 'token-dictionary.js'),
      path.join(ctx.root, 'lib', 'chinese-amount.js'),
      path.join(ctx.root, 'lib', 'template-security.js'),
      tplDir,
    ],
    outputs: [outFile],
  };
}

module.exports = { buildTemplateRenderStep, templateOutPath };
