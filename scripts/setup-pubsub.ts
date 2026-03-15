import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

// Load environment variables
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function checkAuth(authClient: any) {
  try {
    await authClient.getAccessToken();
    return true;
  } catch (error) {
    return false;
  }
}

async function setupPubSub() {
  console.log('\n🌟 MyWallet - Gmail Pub/Sub Webhook Setup 🌟\n');

  try {
    // 1. Authenticate
    console.log('Authenticating with Google Cloud...');
    let authClient;

    try {
      // Try Application Default Credentials first
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/pubsub', 'https://www.googleapis.com/auth/cloud-platform']
      });
      authClient = await auth.getClient();
      console.log('✅ Found Application Default Credentials');
    } catch {
      console.log('❌ Could not find Application Default Credentials.');
      console.log('Please set GOOGLE_APPLICATION_CREDENTIALS environment variable or run:');
      console.log('  gcloud auth application-default login\n');
      process.exit(1);
    }

    const pubsub = google.pubsub({ version: 'v1', auth: authClient });
    
    // 2. Get Project ID
    let projectId = await authClient.getProjectId();
    if (!projectId) {
      projectId = await question('Enter your Google Cloud Project ID: ');
    } else {
      console.log(`✅ Using Project ID: ${projectId}`);
    }

    const defaultTopicId = 'mywallet-gmail-webhooks';
    const topicId = await question(`\nEnter a Topic ID [${defaultTopicId}]: `) || defaultTopicId;
    const topicName = `projects/${projectId}/topics/${topicId}`;

    // 3. Create or Get Topic
    try {
      console.log(`\nCreating topic: ${topicName}...`);
      await pubsub.projects.topics.create({ name: topicName });
      console.log('✅ Topic created successfully!');
    } catch (error: any) {
      if (error.code === 409) {
        console.log('✅ Topic already exists. Proceeding...');
      } else {
        throw error;
      }
    }

    // 4. Grant Publish Permission to Gmail API
    console.log('\nGranting Publish permissions to Gmail API...');
    const gmailServiceAccount = 'serviceAccount:gmail-api-push@system.gserviceaccount.com';
    
    const policy = await pubsub.projects.topics.getIamPolicy({
      resource: topicName
    });

    const bindings = policy.data.bindings || [];
    const hasPermission = bindings.some(b => 
      b.role === 'roles/pubsub.publisher' && 
      b.members?.includes(gmailServiceAccount)
    );

    if (!hasPermission) {
      bindings.push({
        role: 'roles/pubsub.publisher',
        members: [gmailServiceAccount]
      });

      await pubsub.projects.topics.setIamPolicy({
        resource: topicName,
        requestBody: {
          policy: { bindings, etag: policy.data.etag }
        }
      });
      console.log('✅ Granted Gmail API permission to publish to this topic!');
    } else {
      console.log('✅ Gmail API already has publish permissions.');
    }

    // 5. Create Push Subscription
    const defaultSubId = `${topicId}-sub`;
    const subId = await question(`\nEnter a Subscription ID [${defaultSubId}]: `) || defaultSubId;
    const subName = `projects/${projectId}/subscriptions/${subId}`;
    
    // Suggest URL based on common ngrok setup (assuming port 3000)
    console.log(`\nEnter the Public Webhook URL (e.g. from ngrok) where your API is running.`);
    console.log('It MUST be HTTPS. Example: https://1234-abcd.ngrok-free.app/api/gmail/webhook');
    const webhookUrl = await question('> Webhook URL: ');

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      console.log('\n❌ Invalid URL. Push subscriptions require HTTPS.');
      process.exit(1);
    }

    try {
      console.log(`\nCreating push subscription: ${subName}...`);
      await pubsub.projects.subscriptions.create({
        name: subName,
        requestBody: {
          topic: topicName,
          pushConfig: {
            pushEndpoint: webhookUrl
          },
          ackDeadlineSeconds: 30
        }
      });
      console.log('✅ Subscription created successfully!');
    } catch (error: any) {
      if (error.code === 409) {
        console.log('⚠️ Subscription already exists.');
        const update = await question('Do you want to update its webhook URL? (y/n) [y]: ');
        if (update.toLowerCase() !== 'n') {
          await pubsub.projects.subscriptions.modifyPushConfig({
            subscription: subName,
            requestBody: {
              pushConfig: { pushEndpoint: webhookUrl }
            }
          });
          console.log('✅ Subscription Webhook URL updated!');
        }
      } else {
        throw error;
      }
    }

    console.log('\n🎉 Setup Complete! 🎉');
    console.log('\nNext Steps:');
    console.log('1. Use this Pub/Sub Topic Name when linking a Gmail account in the app:');
    console.log(`   ${topicName}`);
    console.log('2. Ensure your backend is running and the webhook URL is accessible.');

  } catch (error: any) {
    console.error('\n❌ An error occurred:');
    console.error(error.message);
  } finally {
    rl.close();
  }
}

setupPubSub();
