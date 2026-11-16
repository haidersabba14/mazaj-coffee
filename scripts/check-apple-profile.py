import os,sys,plistlib,datetime,pathlib
profile=plistlib.load(open(sys.argv[1],'rb'));ent=profile['Entitlements'];bundle=os.environ['APP_BUNDLE_ID'];team=os.environ['APPLE_TEAM_ID']
assert profile['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),'Provisioning profile expired'
assert team in profile.get('TeamIdentifier',[]),'Team mismatch'
app=ent.get('application-identifier','');assert app==team+'.'+bundle or app==team+'.*','Bundle ID mismatch'
assert not ent.get('get-task-allow',False),'Distribution profile required'
assert profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'),'Device distribution profile required for this export'
options={'method':'release-testing','signingStyle':'manual','teamID':team,'provisioningProfiles':{bundle:profile['UUID']}}
plistlib.dump(options,open(os.environ['RUNNER_TEMP']+'/ExportOptions.plist','wb'))
# Push entitlement only exists when the supplied profile grants it.
plistlib.dump({'aps-environment':ent['aps-environment']} if 'aps-environment' in ent else {},open(os.environ['RUNNER_TEMP']+'/royal.entitlements','wb'))
print('Signing profile validated; APNs entitlement:',bool(ent.get('aps-environment')))
