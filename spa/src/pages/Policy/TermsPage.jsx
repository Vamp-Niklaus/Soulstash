import React from 'react';
import { NavLink } from 'react-router-dom';

import { PolicyPage } from './PolicyPage.jsx';

export function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      subtitle="Last updated: January 31, 2026"
      sections={[
        { heading: '1. Acceptance of Terms', paragraphs: ['By accessing and using Soulstash, you accept and agree to be bound by this agreement. If you do not agree, please do not use the service.'] },
        { heading: '2. Description of Service', paragraphs: ['Soulstash is a movie discovery and tracking platform that lets users browse, search, and keep track of movies and TV shows with recommendations, watchlists, and collection features.'] },
        { heading: '3. User Registration', paragraphs: ['To access certain features, you must register for an account and provide accurate, current, and complete information.'] },
        {
          heading: '4. User Conduct',
          paragraphs: ['You agree not to use the service to:'],
          items: [
            'Upload or transmit unlawful, harmful, threatening, abusive, harassing, or vulgar content',
            'Impersonate any person or entity',
            'Upload files containing viruses, worms, or similar software',
            'Interfere with or disrupt the service or connected networks'
          ]
        },
        { heading: '5. Privacy', paragraphs: ['Your privacy matters to us. Please review our Privacy Policy to understand how we handle your information.'] },
        { heading: '6. Intellectual Property', paragraphs: ['The service and its original content, features, and functionality remain the exclusive property of Soulstash and its licensors.'] },
        { heading: '7. Termination', paragraphs: ['We may terminate or suspend your account and bar access to the service immediately and without prior notice under our sole discretion.'] },
        { heading: '8. Limitation of Liability', paragraphs: ['Soulstash and its affiliates are not liable for indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, use, or goodwill.'] },
        { heading: '9. Changes to Terms', paragraphs: ['We may modify or replace these terms at any time. If a revision is material, we will try to provide advance notice before it takes effect.'] },
        { heading: '10. Contact Information', paragraphs: ['If you have questions about these Terms of Service, contact us at soulstash.onrender@gmail.com.'] }
      ]}
    />
  );
}
