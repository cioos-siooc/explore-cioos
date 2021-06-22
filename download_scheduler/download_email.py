import subprocess


def send_email(email, message, subject):
    line = f"echo '{message}' | mail -s '{subject}' {email}"
    print(line)
    res = subprocess.run(["sh", "-c", line])
    print(res)
