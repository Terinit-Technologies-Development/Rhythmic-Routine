Pod::Spec.new do |s|
  s.name           = 'RhythmDevice'
  s.version        = '0.1.0'
  s.summary        = 'Native rhythm device module for Rhythmic-Routine'
  s.description    = 'Native Family Controls, Device Activity, and Usage observation module'
  s.author         = 'Terinit Technologies'
  s.homepage       = 'https://github.com/Terinit-Technologies-Development/Rhythmic-Routine'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.source_files   = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.swift_version  = '5.4'
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'FamilyControls', 'DeviceActivity', 'ManagedSettings'
end
