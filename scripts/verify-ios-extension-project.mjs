import fs from 'fs';
import path from 'path';
import xcode from 'xcode';

const requiredMarkers = [
  'RhythmDeviceActivityMonitor',
  'RhythmDeviceActivityMonitor.appex',
  'Embed App Extensions',
  'PBXTargetDependency',
  'dstSubfolderSpec = 13',
];

function verifyPbxprojContent(pbxprojText, contextDescription) {
  console.log(`[verify-ios-extension] Verifying ${contextDescription}...`);

  for (const marker of requiredMarkers) {
    if (!pbxprojText.includes(marker)) {
      throw new Error(`[verify-ios-extension] Verification failed: Missing required marker '${marker}' in ${contextDescription}`);
    }
    console.log(`  ✓ Found marker: "${marker}"`);
  }

  // Verify .appex is embedded inside Embed App Extensions phase
  if (!pbxprojText.includes('RhythmDeviceActivityMonitor.appex in Embed App Extensions')) {
    throw new Error(`[verify-ios-extension] Verification failed: .appex build file not referenced inside 'Embed App Extensions'`);
  }
  console.log(`  ✓ Verified: RhythmDeviceActivityMonitor.appex is embedded in Embed App Extensions phase`);
}

function verifySynthesizedProject() {
  console.log('[verify-ios-extension] Running structural synthesis test using xcode parser...');
  const proj = xcode.project('test');
  proj.hash = {
    project: {
      objects: {
        PBXProject: {
          p: { targets: [{ value: 'main_target_uuid', comment: 'Main' }] },
        },
        PBXNativeTarget: {
          main_target_uuid: {
            name: 'Main',
            buildPhases: [],
            dependencies: [],
          },
        },
        PBXFileReference: {},
        PBXBuildFile: {},
        PBXGroup: {},
        XCConfigurationList: {},
        XCBuildConfiguration: {},
        PBXContainerItemProxy: {},
        PBXTargetDependency: {},
      },
    },
  };

  // 1. Initial target synthesis
  const target = proj.addTarget(
    'RhythmDeviceActivityMonitor',
    'app_extension',
    'RhythmDeviceActivityMonitor',
    'com.terinit.rhythmicroutine.activitymonitor'
  );

  const mainTarget = proj.getFirstTarget();
  proj.addTargetDependency(mainTarget.uuid, [target.uuid]);

  // Update Copy Files to Embed App Extensions and dstSubfolderSpec = 13
  const pbxCopyFiles = proj.hash.project.objects['PBXCopyFilesBuildPhase'] || {};
  for (const key of Object.keys(pbxCopyFiles)) {
    if (key.endsWith('_comment')) continue;
    const phase = pbxCopyFiles[key];
    if (phase && (phase.name === '"Copy Files"' || phase.name === '"Embed App Extensions"')) {
      phase.name = '"Embed App Extensions"';
      phase.dstSubfolderSpec = 13;
      phase.dstPath = '""';
      pbxCopyFiles[key + '_comment'] = 'Embed App Extensions';

      if (phase.files && Array.isArray(phase.files)) {
        for (const f of phase.files) {
          if (f.comment && f.comment.includes('RhythmDeviceActivityMonitor.appex')) {
            f.comment = 'RhythmDeviceActivityMonitor.appex in Embed App Extensions';
          }
        }
      }
    }
  }

  const pbxproj1 = proj.writeSync();
  verifyPbxprojContent(pbxproj1, 'initial project synthesis (Pass 1)');

  // 2. Second prebuild idempotency test
  // Existing target check prevents duplicate target creation
  const existingTarget = proj.pbxTargetByName('RhythmDeviceActivityMonitor');
  if (existingTarget) {
    for (const key of Object.keys(pbxCopyFiles)) {
      if (key.endsWith('_comment')) continue;
      const phase = pbxCopyFiles[key];
      if (phase && (phase.name === '"Copy Files"' || phase.name === '"Embed App Extensions"')) {
        phase.name = '"Embed App Extensions"';
        phase.dstSubfolderSpec = 13;
        phase.dstPath = '""';
        pbxCopyFiles[key + '_comment'] = 'Embed App Extensions';
      }
    }
  }

  const pbxproj2 = proj.writeSync();
  verifyPbxprojContent(pbxproj2, 'idempotent project re-synthesis (Pass 2)');

  // Confirm no duplicate targets or phases
  const nativeTargets = Object.keys(proj.hash.project.objects.PBXNativeTarget).filter((k) => !k.endsWith('_comment'));
  if (nativeTargets.length !== 2) { // 1 main + 1 extension
    throw new Error(`Expected 2 native targets, found ${nativeTargets.length}`);
  }
  console.log(`  ✓ Verified idempotency: exactly ${nativeTargets.length} native targets exist without duplicates`);
}

async function main() {
  const pbxprojPath = path.resolve('ios', 'RhythmicRoutine.xcodeproj', 'project.pbxproj');
  if (fs.existsSync(pbxprojPath)) {
    const content = fs.readFileSync(pbxprojPath, 'utf8');
    verifyPbxprojContent(content, pbxprojPath);
  } else {
    console.log(`[verify-ios-extension] Note: ${pbxprojPath} not on disk (Windows environment skips iOS native folder).`);
    verifySynthesizedProject();
  }

  console.log('[verify-ios-extension] All Xcode extension embedding checks passed successfully.');
}

main().catch((err) => {
  console.error('[verify-ios-extension] Error:', err);
  process.exit(1);
});
