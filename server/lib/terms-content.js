/**
 * iMove Relocations — Terms & Conditions content.
 *
 * The full T&C text, transcribed from the client-supplied document, as
 * structured data so it can be rendered into a branded PDF (see
 * services/pdf.js → generateTermsPDF) and kept under version control.
 *
 * Each section has a `title` and an array of `lines`. A line's `num` (e.g.
 * "1.2.1") drives its indent level (counted by dots); a line with `num: null`
 * is a plain paragraph (used for the introduction and notes).
 */

const INTRO = [
  "These conditions explain the rights, obligations, and responsibilities of all parties to this Agreement. Where we use the word 'you' or 'your' it means the Customer: 'we', 'us' or 'our' means the Remover. These terms and conditions can be varied or amended subject to prior written agreement. Your attention is drawn to Clauses 4, 9, 10, 11 and 12 which set out our liability to you for loss of or damage to goods and property.",
];

const SECTIONS = [
  {
    title: '1 Our Quotation',
    lines: [
      ['1.1', 'Our quotation, unless otherwise stated, does not include customs duties and inspections or any other fees or taxes payable to government bodies. It does include us accepting liability for your goods, subject to clauses 2.2, 3.2, 5.2, 5.3 and the provisions of Clauses 4, 9, 10, 11 and 12.'],
      ['1.2', 'We may change the price or make additional charges if circumstances are found to apply which have not been taken into account when preparing our quotation and confirmed by us in writing. These include:'],
      ['1.2.1', 'You do not accept our quotation in writing within 28 days, or the work is not carried out or completed within three months.'],
      ['1.2.2', 'Our costs change because of currency fluctuations or changes in taxation or freight charges beyond our control.'],
      ['1.2.3', 'The work is carried out on a Saturday, Sunday, or Public Holiday or outside normal hours (08.00-18.00hrs) at your request.'],
      ['1.2.4', 'We have to collect or deliver goods at your request above the ground floor and first upper floor.'],
      ['1.2.5', 'If you collect some or all of the goods from our warehouse, we are entitled to make a charge for handing them over.'],
      ['1.2.6', 'We supply any additional services, including moving or storing extra goods (these conditions apply to such work).'],
      ['1.2.7', 'The stairs, lifts or doorways are inadequate for free movement of the goods without mechanical equipment or structural alteration, or the approach, road or drive is unsuitable for our vehicles and/or containers to load and/or unload within 20 metres of the doorway.'],
      ['1.2.8', 'We have to pay parking or other fees or charges in order to carry out services on your behalf.'],
      ['1.2.9', 'There are delays or events outside our reasonable control which increase or extend the resources or time allowed to complete the agreed work.'],
      ['1.2.10', 'We agree in writing to increase our limit of liability set out in clause 9.1.1'],
      ['1.3', 'In any such circumstances, adjusted charges will apply and become payable.'],
    ],
  },
  {
    title: '2 Work not included in the quotation',
    lines: [
      ['2.1', 'Unless agreed by us in writing, we will not:'],
      ['2.1.1', 'Dismantle or assemble unit or system furniture (flat-pack), fitments or fittings.'],
      ['2.1.2', 'Disconnect, re-connect, dismantle or re-assemble appliances, fixtures, fittings or equipment.'],
      ['2.1.3', 'Take up or lay fitted floor coverings.'],
      ['2.1.4', 'Move items from a loft, unless properly lit and floored and safe access is provided.'],
      ['2.1.5', 'Move or store any items excluded under Clause 5.'],
      ['2.2', 'Our staff are not authorized or qualified to carry out such work. We recommend that a properly qualified person is separately employed by you to carry out these services.'],
    ],
  },
  {
    title: '3 Your responsibility',
    lines: [
      ['3.1', 'It will be your sole responsibility to:'],
      ['3.1.1', 'Declare to us, in writing, the value of the goods being removed and/or stored. If it is subsequently established that the value of the goods removed or stored is greater than the actual value you declare, you agree that our liability under clause 9.1 will be reduced to reflect the proportion that your declared value bears to their actual value.'],
      ['3.1.2', 'Obtain at your own expense, all documents, permits, permissions, licences, customs documents necessary for the removal to be completed.'],
      ['3.1.3', 'Be present or represented during the collection and delivery of the removal.'],
      ['3.1.4', 'Ensure authorized signature on agreed inventories, receipts, waybills, job sheets or other relevant documents by way of confirmation of collection or delivery of goods.'],
      ['3.1.5', 'Take all reasonable steps to ensure that nothing that should be removed is left behind and nothing is taken away in error.'],
      ['3.1.6', 'Arrange proper protection for goods left in unoccupied or unattended premises, or where other people such as (but not limited to) tenants or workmen are, or will be present.'],
      ['3.1.7', 'Prepare adequately and stabilize all appliances or electronic equipment prior to their removal.'],
      ['3.1.8', 'Empty, properly defrost and clean refrigerators and deep freezers. We are not responsible for the contents.'],
      ['3.1.9', 'Provide us with a contact address for correspondence during removal transit and/or storage of goods.'],
      ['3.2', 'Other than by reason of our negligence or breach of contract, we will not be liable for any loss or damage, costs or additional charges that may arise from failure to discharge these responsibilities.'],
    ],
  },
  {
    title: '4 Our responsibility',
    lines: [
      ['4.1', 'It is our responsibility to deliver your goods to you, or produce them for your collection, undamaged. By "undamaged" we mean in the same condition as they were in at the time when they were packed or otherwise made ready for transportation and/or storage.'],
      ['4.2', 'In the event that we have undertaken to pack the goods, or otherwise make them ready for transportation and/or storage, it is our responsibility to deliver them to you, or produce them for your collection, undamaged. Again, by "undamaged" we mean in the same condition as they were in immediately prior to being packed/made ready for transportation or storage.'],
      ['4.3', 'If we fail to discharge the responsibilities identified in clause 4.1 and 4.2, we will, subject to the provisions of clauses 9, 11 and 12, be liable under this agreement to compensate you for such failure.'],
      ['4.4', 'We will not be liable to compensate you where clauses 2.2, 3.2, 5.2 and 5.3 apply unless loss or damage occurred as a result of negligence or breach of contract on our part.'],
      ['4.5', 'If you do not provide us with a declaration of value of your goods, or if you do not require us to accept standard liability pursuant to clause 9.1 we will not be liable to you for failure to discharge the responsibilities identified in clause 4.1 and 4.2, unless that failure was caused by negligence or breach of contract on our part.'],
      ['4.6', 'The amount of our liability under this clause shall be determined in accordance with clauses 9 and 11.'],
    ],
  },
  {
    title: '5 Goods not to be submitted for removal or storage',
    lines: [
      ['5.1', 'Unless previously agreed in writing by a director or other authorized company representative, the following items must not be submitted for removal or storage and will under no circumstances be moved or stored by us. The items listed under 5.1.1 below may present risks to health and safety and of fire. Items listed under 5.1.2 to 5.1.6 below carry other risks and you should make your own arrangements for their transport and storage.'],
      ['5.1.1', 'Prohibited or stolen goods, drugs, pornographic material, potentially dangerous, damaging or explosive items, including gas bottles, aerosols, paints, firearms and ammunition.'],
      ['5.1.2', 'Jewellery, watches, trinkets, precious stones or metals, money, deeds, securities, stamps, coins, or goods or collections of any similar kind.'],
      ['5.1.3', 'Plants or goods likely to encourage vermin or other pests or to cause infestation or contamination.'],
      ['5.1.4', 'Perishable items and/or those requiring a controlled environment.'],
      ['5.1.5', 'Any animals, birds or fish.'],
      ['5.1.6', 'Goods which require special licence or government permission for export or import.'],
      ['5.2', 'If we do agree to remove such goods, we will not accept liability for loss or damage unless we are negligent or in breach of contract, in which case all these conditions will apply.'],
      ['5.3', 'If you submit such goods without our knowledge we will make them available for your collection and if you do not collect them within a reasonable time we will apply for an appropriate court order to dispose of any such goods found in the consignment without notice. You will furthermore pay to us any charges, expenses, damages, legal costs or penalties incurred by us.'],
    ],
  },
  {
    title: '6 Ownership of the goods',
    lines: [
      ['6.1', 'By entering into this Agreement, you guarantee that:'],
      ['6.1.1', 'The goods to be removed and/or stored are your own property, or'],
      ['6.1.2', 'The person(s) who own or have an interest in them have given you authority to make this contract and have been made aware of these conditions.'],
      ['6.1.3', 'You will pay us for any claim for damages and/or costs brought against us if either warranty 6.1.1 or 6.1.2 is not true.'],
    ],
  },
  {
    title: '7 Charges if you postpone or cancel the removal',
    lines: [
      ['7.1', 'If you postpone or cancel this Agreement, we will charge you according to how much notice is given. "Working days" refer to the normal working week of Monday to Friday and excludes weekends and Public Holidays.'],
      ['7.1.1', 'More than 10 working days before the removal was due to start: No charge.'],
      ['7.1.2', 'Between 5 and 10 working days inclusive before the removal was due to start: not more than 30% of the removal charge.'],
      ['7.1.3', 'Less than 5 working days before the removal was due to start: not more than 60% of the removal charge.'],
    ],
  },
  {
    title: '8 Payment',
    lines: [
      ['8.1', 'Unless otherwise agreed by us in writing:'],
      ['8.1.1', 'Payment is required by cleared funds in advance of the removal or storage period.'],
      ['8.1.2', 'You may not withhold any part of the agreed price.'],
      ['8.1.3', 'In respect of all sums which are overdue to us, we will charge interest on a daily basis calculated at 4% per annum above the prevailing base rate for the time being of the Bank of England.'],
    ],
  },
  {
    title: '9 Determination of amount of our liability for loss or damage',
    lines: [
      ['9.1', 'Standard Liability.'],
      ['9.1.1', 'If you provide us with a declaration of the value of your goods, and subject to clause 3.1.1, the amount of our liability to you in the event of loss or damage to those goods in breach of clause 4 will be determined in accordance with Clauses 9.1.2, 9.1.3 and 11 below, subject to a maximum liability of £25,000. We may agree to accept liability for a higher amount, in which case we may make an additional charge.'],
      ['9.1.2', 'In the event of loss of or damage to your goods in breach of clause 4, our liability to you is to be assessed as a sum equivalent to the cost of their repair or replacement whichever is the smaller sum, taking into account the age and condition of the goods immediately prior to their loss or damage, and subject to the maximum liability of £25,000 referred to in clause 9.1.1 (unless we have agreed a higher amount with you).'],
      ['9.1.3', 'Where the lost or damaged item is part of a pair or set, our liability to you, where it is assessed as the cost of replacement of that item, is to be assessed as a sum equivalent to the cost of that item in isolation, not the cost of that item as part of a pair or set.'],
      ['9.2', 'Limited Liability.'],
      ['9.2.1', 'If you do not provide us with a declaration of value, or if you do not require us to accept Standard Liability pursuant to clause 9.1, then our liability to you is to be determined in accordance with Clauses 9.1.3, 9.2.2 and 11.'],
      ['9.2.2', 'In the event of loss of or damage to your goods caused by negligence or breach of contract on our part, our liability to you is to be assessed as a sum equivalent to the cost of their repair or replacement, taking into account their age and condition immediately prior to their loss or damage, subject to a maximum liability of £40 per item. Your attention is drawn to clause 11.1 which applies to Limited Liability.'],
      ['9.3', 'For goods destined to or received from a place outside the UK'],
      ['9.3.1', 'We will only accept Standard Liability if you provide us with a detailed valuation of your goods on the valuation form which we provide. All other provisions of Clause 9.1 will apply.'],
      ['9.3.2', 'We do not accept liability for loss of or damage to goods confiscated, seized, removed or damaged by Customs Authorities or other Government Agencies unless we have been negligent or in breach of contract.'],
      ['9.3.3', 'We do not accept liability for loss of or damage to goods occurring in certain overseas countries, including Gambia, Iran, Iraq, Nigeria, Libya, Lebanon, Angola, Cambodia, Vietnam, N. Korea and Former States of the USSR, unless we have been negligent or in breach of contract. This list is not exhaustive, and we will advise you at the time of quotation if this exclusion applies. We will accept liability for loss or damage (a) arising from our negligence or breach of contract whilst the goods are in our physical possession, or (b) whilst the goods are in the possession of others if the loss or damage is established to have been caused by our failure to pack the goods to a reasonable standard where we have been contracted to pack the goods that are subject to the claim. In either circumstance clause 9.1 or 9.2 above will apply.'],
      ['9.4', 'An Item is defined as:-'],
      ['9.4.1', 'The entire contents of a box, parcel, package, carton, or similar container; and'],
      ['9.4.2', 'Any other object or thing that is moved, handled or stored by us.'],
    ],
  },
  {
    title: '10 Damage to premises or property other than goods',
    lines: [
      ['10.1', 'Because third party contractors are frequently present at the time of collection or delivery our liability for loss or damage is limited as follows:'],
      ['10.1.1', 'If we cause loss or damage to premises or property other than goods for removal as a result of our negligence or breach of contract, our liability shall be limited to making good the damaged area only.'],
      ['10.1.2', 'If we cause damage as a result of moving goods under your express instruction, against our advice, and where to move the goods in the manner instructed is likely to cause damage, we shall not be liable.'],
      ['10.1.3', 'If we are responsible for causing damage to your premises or to property other than goods submitted for removal and/or storage, you must note this on the worksheet or delivery receipt as soon as practically possible or within a reasonable time. This is fundamental to the Agreement.'],
    ],
  },
  {
    title: '11 Exclusions of liability',
    lines: [
      ['11.1', 'In respect of Limited Liability, we will not be liable for loss of or damage to your goods as a result of fire or explosion howsoever that fire or explosion was caused, unless we have been negligent or in breach of contract.'],
      ['11.2', 'In respect of Standard Liability and Limited Liability, other than as a result of our negligence or breach of contract we will not be liable for any loss of, damage to, or failure to produce the following goods:-'],
      ['11.2.1', 'Bonds, Securities, Stamps of all kinds, Manuscripts or other Documents or Electronically held Data Records, Mobile Telephones'],
      ['11.2.2', 'Plants or goods likely to encourage vermin or other pests or to cause infestation or contamination.'],
      ['11.2.3', 'Perishable items and/or those requiring a controlled environment.'],
      ['11.2.4', 'Furs exceeding £100 in value, Jewellery, Watches, Precious Stones and Metals, Money, Coins, Deeds.'],
      ['11.2.5', 'Any animals, birds or fish.'],
      ['11.3', 'In respect of Standard Liability and Limited Liability, other than as a result of our negligence or breach of contract we will not be liable for any loss of, damage to, or failure to produce the goods if caused by any of the following circumstances:-'],
      ['11.3.1', 'By war, invasion, acts of foreign enemies, hostilities (whether war is declared or not), civil war, terrorism, rebellion and/or military coup, Act of God, industrial action or other such events outside our reasonable control.'],
      ['11.3.2', 'Loss or damage arising from ionising radiations or radioactive contamination'],
      ['11.3.3', 'Loss or damage arising from Chemical, Biological, Bio-chemical, Electromagnetic Weapons and Cyber Attack'],
      ['11.3.4', 'Indirect or consequential loss of any kind or description'],
      ['11.3.5', 'By normal wear and tear, natural or gradual deterioration, leakage or evaporation or from perishable or unstable goods. This includes goods left within furniture or appliances.'],
      ['11.3.6', 'By vermin, moth, insects and similar infestation, damp, mould, mildew or rust'],
      ['11.3.7', 'By cleaning, repairing or restoring unless we arranged for the work to be carried out.'],
      ['11.3.8', 'By change to atmospheric or climatic conditions.'],
      ['11.3.9', 'For any goods in wardrobes, drawers or appliances, or in a package, bundle, carton, case or other container not both packed and unpacked by us.'],
      ['11.3.10', 'Loss of or damage to china, glassware and fragile items unless they have been both professionally packed and unpacked by us or our Subcontractor. In the event of an accident involving an owner packed container where damage would have occurred irrespective of the quality of the packing, then our liability is limited to £100 or its actual value whichever is less.'],
      ['11.3.11', 'For electrical or mechanical derangement to any appliance, instrument, clock, computer or other equipment unless there is evidence of related external damage.'],
      ['11.3.12', 'Loss or damage of motor vehicles caused by scratching, denting and marring unless you obtain from us a pre-collection condition report.'],
      ['11.3.13', 'Loss or damage to a vehicle whilst being driven or for the purpose of being driven under its own power other than for the purpose of loading onto or unloading from the carrying conveyance or container. Loss or damage sustained by accessories and removable items unless lost with the vehicle'],
      ['11.3.14', 'For any goods which have a pre-existing defect or are inherently defective.'],
      ['11.4', 'No employee of ours shall be separately liable to you for any loss, damage, mis-delivery, errors or omissions under the terms of this Agreement.'],
      ['11.5', 'Our liability will cease upon handing over goods from our warehouse or upon completion of delivery (see Clause 12.2 below).'],
    ],
  },
  {
    title: '12 Time limit for claims',
    lines: [
      ['12.1', 'For goods which we deliver, you must notify us in writing of any visible loss, damage or failure to produce any goods at the time of delivery.'],
      ['12.2', 'If you or your agent collect the goods, you must notify us in writing of any loss or damage at the time the goods are handed to you or your agent.'],
      ['12.3', 'Notwithstanding clauses 9, 10 and 11 we will not be liable for any loss of or damage to the goods unless a claim is notified to us, or to our agent or the company carrying out the collection or delivery of the goods on our behalf, in writing as soon as such loss or damage is discovered (or with reasonable diligence ought to have been discovered) and in any event within seven (7) days of delivery of the goods by us.'],
      ['12.4', 'The time limit for notifying us of your claim may be extended upon receipt of your written request provided such request is received within seven (7) days of delivery. Consent to such a request will not be unreasonably withheld.'],
    ],
  },
  {
    title: '13 Delays in transit',
    lines: [
      ['13.1', 'Other than by reason of our negligence or breach of contract, we will not be liable for delays in transit.'],
      ['13.2', 'If through no fault of ours we are unable to deliver your goods, we will take them into store. The Agreement will then be fulfilled and any additional service(s), including storage and delivery, will be at your expense.'],
    ],
  },
  {
    title: '14 Our Right to Hold the Goods (lien)',
    lines: [
      [null, 'We shall have a right to withhold and/or ultimately dispose of some or all of the goods until you have paid all our charges and any other payments due under this or any other Agreement. (See also Clause 23). These include any charges that we have paid out on your behalf. While we hold the goods you will be liable to pay all storage charges and other costs incurred by our withholding your goods and these terms and conditions shall continue to apply.'],
    ],
  },
  {
    title: '15 Disputes',
    lines: [
      [null, 'If there is a dispute arising from this agreement which cannot be resolved, subject to the agreement of both parties, either you or we may refer the dispute to an arbitrator appointed by the Chartered Institute of Arbitrators. The cost of any such arbitration will be at the discretion of the arbitrator. This does not prejudice your right to commence court proceedings.'],
    ],
  },
  {
    title: '16 Our right to sub-contract the work',
    lines: [
      ['16.1', 'We reserve the right to sub-contract some or all of the work.'],
      ['16.2', 'If we sub-contract, then these conditions will still apply.'],
    ],
  },
  {
    title: '17 Route and method',
    lines: [
      ['17.1', 'We have the right to choose the method and route by which to carry out the work.'],
      ['17.2', 'Unless it has been specifically agreed otherwise in writing in our Quotation, other space/volume/capacity on our vehicles and/or the container may be utilized for consignments of other customers.'],
    ],
  },
  {
    title: '18 Advice and information for International Removals',
    lines: [
      [null, 'We will use our reasonable endeavours to provide you with up to date information to assist you with the import/export of your goods. Information on such matters as national or regional laws and regulations which are subject to change and interpretation at any time is provided in good faith and is based upon existing known circumstances. It is your responsibility to seek appropriate advice to verify the accuracy of any information provided.'],
    ],
  },
  {
    title: '19 Applicable law',
    lines: [
      [null, 'This contract is subject to the law of the country in which the office of the company issuing this contract is situated.'],
    ],
  },
  {
    title: '20 Your forwarding address',
    lines: [
      ['20.1', 'If you send goods to be stored, you must provide an address for correspondence and notify us if it changes. All correspondence and notices will be considered to have been received by you seven days after sending it to your last address recorded by us.'],
      ['20.2', 'If you do not provide an address or respond to our correspondence or notices, we may publish such notices in a public newspaper in the area to or from which the goods were removed. Such notice will be considered to have been received by you seven days after the publication date of the newspaper.'],
      [null, 'Note: If we are unable to contact you, we will charge you any costs incurred in establishing your whereabouts.'],
    ],
  },
  {
    title: '21 List of goods (inventory) or receipt',
    lines: [
      [null, 'Where we produce a list of your goods (inventory) or a receipt and send it to you, it will be accepted as accurate unless you write to us within 10 days of the date of our sending, or a reasonable period agreed between us, notifying us of any errors or omissions.'],
    ],
  },
  {
    title: '22 Revision of storage charges',
    lines: [
      [null, 'We review our storage charges periodically. You will be given 3 months notice in writing of any increases.'],
    ],
  },
  {
    title: '23 Our right to Sell or dispose of the Goods',
    lines: [
      [null, "If payment of our charges relating to your goods is in arrears, and on giving you three months' notice, we are entitled to require you to remove your goods from our custody and pay all money due to us. If you fail to pay all outstanding amounts due to us, we may sell or dispose of some or all of the goods without further notice. The cost of the sale or disposal will be charged to you. The net proceeds will be credited to your account and any eventual surplus will be paid to you without interest. If the full amount due is not received, we may seek to recover the balance from you."],
    ],
  },
  {
    title: '24 Termination',
    lines: [
      [null, "If payments are up to date, we will not end this contract except by giving you three months notice in writing. If you wish to terminate your storage contract, you must give us at least 10 working days' notice (working days are defined in Clause 7 above). If we can release the goods earlier, we will do so, provided that your account is paid up to date. Charges for storage are payable to the date when the notice should have taken effect."],
    ],
  },
];

const FOOTER_NOTE = 'Liability Terms - For Non British Association of Removers Members';

module.exports = { INTRO, SECTIONS, FOOTER_NOTE };
