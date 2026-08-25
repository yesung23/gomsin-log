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
  # Unchanged from the app's floor. FoundationModels is reached through
  # `#if canImport` plus `@available(iOS 26.0, *)`, so raising the deployment
  # target would drop iOS 14-17 devices to buy nothing.
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
