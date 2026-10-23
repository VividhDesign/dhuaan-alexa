#!/usr/bin/env bash
# One-time Alexa+ add-on tooling setup (per developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html).
# Uses the existing default profile as the source profile instead of a new IAM user.
set -euo pipefail

aws iam put-user-policy --user-name vividh-cli --policy-name AlexaAiToolsAssume --policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:AssumeRole","Resource":"arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead"}]}'
aws configure set profile.alexa-ai.role_arn arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead
aws configure set profile.alexa-ai.source_profile default
aws configure set profile.alexa-ai.region us-west-2
sleep 10  # IAM propagation
aws sts get-caller-identity --profile alexa-ai

# CodeCommit helper, scoped to the CodeCommit host only
git config --global "credential.https://git-codecommit.us-west-2.amazonaws.com.helper" '!aws codecommit credential-helper --profile alexa-ai $@'
git config --global "credential.https://git-codecommit.us-west-2.amazonaws.com.UseHttpPath" true

# npm registry for the @alexa-ai scope only
aws codeartifact login --tool npm --domain alexa-ai --repository npm-packages --domain-owner 372468808636 \
  --region us-west-2 --namespace @alexa-ai --profile alexa-ai

npm install -g @alexa-ai/cli
alexa-ai --version
alexa-ai configure   # opens Login with Amazon in the browser
