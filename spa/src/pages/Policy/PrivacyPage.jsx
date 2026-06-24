import React from 'react';
import { NavLink } from 'react-router-dom';

import { PolicyPage } from './PolicyPage.jsx';

export function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      subtitle="Last updated: January 31, 2026"
      sections={[
        { heading: '1. Introduction', paragraphs: ['Soulstash is committed to protecting your privacy. This policy explains how we collect, use, disclose, and safeguard your information when you use the service.'] },
        { heading: '2. Information We Collect', paragraphs: ['We may collect personal data you provide during registration, usage data such as browser and access information, and tracking or cookie data used to improve the service.'] },
        {
          heading: '3. How We Use Your Information',
          paragraphs: ['Soulstash uses collected data to:'],
          items: [
            'Provide and maintain the service',
            'Notify you about changes',
            'Provide customer support',
            'Analyze and improve the product',
            'Monitor usage and detect issues'
          ]
        },
        {
          heading: '4. Sharing Your Information',
          paragraphs: ['We do not sell your personal information without your consent, except in limited cases such as trusted providers, legal obligations, or mergers/acquisitions.']
        },
        { heading: '5. Data Security', paragraphs: ['We use appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.'] },
        { heading: '6. Data Retention', paragraphs: ['We retain your personal information only as long as necessary for the purposes described in this policy, or longer where required for complaints or legal reasons.'] },
        {
          heading: '7. Your Rights',
          paragraphs: ['You may have rights to access, correct, erase, restrict, object to processing, or request portability of your personal information.']
        },
        { heading: "8. Children's Privacy", paragraphs: ['Our service is not directed to children under 13, and we do not knowingly collect personal information from them.'] },
        { heading: '9. Changes to This Privacy Policy', paragraphs: ['We may update this policy from time to time and will update the date shown on this page when we do.'] },
        { heading: '10. Contact Us', paragraphs: ['If you have any questions about this Privacy Policy, contact us at soulstash.onrender@gmail.com.'] }
      ]}
    />
  );
}
