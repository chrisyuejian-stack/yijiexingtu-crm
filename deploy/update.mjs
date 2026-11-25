import {updateRelease,rollbackRelease} from './release-manager.mjs';
import {productionSettings,productionOperations} from './release-ops.mjs';
try {
  const [action,archive,...extra]=process.argv.slice(2);if(!['update','rollback'].includes(action)||action==='update'&&(!archive||extra.length)||action==='rollback'&&archive)throw Error('Usage: update ZIP | rollback');
  const settings=await productionSettings();settings.ops=productionOperations(settings);
  const result=action==='update'?await updateRelease(archive,settings):await rollbackRelease(settings);
  console.log(JSON.stringify(result,null,2));
  if(result.databaseReviewRequired){console.log('代码已切回，数据库未自动恢复，维护保持。确认要回退更新后数据时，再运行：');if(result.restoreCommand)console.log(result.restoreCommand);}
  else if(result.maintenanceKept)console.log('版本健康；原维护状态保留，请核对后手动解除维护。');
  else console.log(action==='update'?'更新完成，健康检查通过。':'代码回滚完成，数据库未覆盖。');
}catch(error){
  console.error('发布操作失败：',error.message);
  if(error.releaseResult){console.error(JSON.stringify(error.releaseResult,null,2));if(error.releaseResult.maintenanceKept&&error.releaseResult.restoreCommand){console.error('未自动覆盖数据库。如确认需要恢复更新前数据，可手动执行：');console.error(error.releaseResult.restoreCommand);}}
  process.exitCode=1;
}
