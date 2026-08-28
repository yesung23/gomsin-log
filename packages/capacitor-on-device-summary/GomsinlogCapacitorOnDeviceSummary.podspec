require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'GomsinlogCapacitorOnDeviceSummary'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://github.com/yesung23/gomsin-log'
  s.author = 'GomsinLog'
  s.source = { :git => 'https://github.com/yesung23/gomsin-log', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  # iOS 15.0 matches the app and Xcode-supported floor. FoundationModels remains
  # runtime-gated by `#if canImport` and `@available(iOS 26.0, *)`.
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
