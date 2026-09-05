require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'GomsinlogCapacitorAppleAuth'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary', :text => 'Copyright GomsinLog. All rights reserved.' }
  s.homepage = 'https://github.com/yesung23/gomsin-log'
  s.author = 'GomsinLog'
  s.source = { :git => 'https://github.com/yesung23/gomsin-log.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.framework = 'AuthenticationServices'
  s.swift_version = '5.9'
end
